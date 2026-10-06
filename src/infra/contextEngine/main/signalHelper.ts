/**
 * contextEngine — native signal helper process (macOS)
 *
 * Spawns native/context-helper (built to build/native/context-helper), reads its JSON lines
 * and restarts it with exponential backoff when it exits unexpectedly.
 * The helper exits by itself when its stdin closes, so it never outlives the app.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import EventEmitter from 'eventemitter3';
import type { IContextAppInfo } from '@appTypes/infra/contextEngine';

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60 * 1000;
/** A run longer than this resets the backoff */
const STABLE_RUN_MS = 60 * 1000;

const HELPER_NAME = 'context-helper';

interface ILog {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
}

interface ISignalHelperEvents {
    /** frontmost app and its pid */
    app: [IContextAppInfo, number];
    mic: [boolean];
    status: ['running' | 'starting' | 'stopped'];
}

/**
 * Helper binary location, or null when it cannot run here.
 * - packaged: <resources>/context-helper (forge `extraResource`)
 * - dev: <repo>/build/native/context-helper (scripts/build-context-helper.sh)
 */
export function resolveHelperPath(isPackaged: boolean, appPath: string): string | null {
    if (process.platform !== 'darwin') return null;
    const candidate = isPackaged
        ? path.join(process.resourcesPath, HELPER_NAME)
        : path.resolve(appPath, 'build', 'native', HELPER_NAME);
    try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
    } catch {
        return null;
    }
}

export class SignalHelperProcess {
    private child: ChildProcessWithoutNullStreams | null = null;
    private stopped = true;
    private backoffMs = MIN_BACKOFF_MS;
    private restartTimer: ReturnType<typeof setTimeout> | null = null;
    private ee = new EventEmitter<ISignalHelperEvents>();

    constructor(
        private readonly binPath: string,
        private readonly log: ILog,
    ) {}

    public on<K extends keyof ISignalHelperEvents>(
        event: K,
        listener: (...args: ISignalHelperEvents[K]) => void,
    ) {
        this.ee.on(event, listener as (...args: unknown[]) => void);
    }

    public start() {
        if (!this.stopped) return;
        this.stopped = false;
        this.backoffMs = MIN_BACKOFF_MS;
        this.spawnChild();
    }

    public stop() {
        if (this.stopped) return;
        this.stopped = true;
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
        const child = this.child;
        this.child = null;
        if (child) {
            child.stdin.end();
            child.kill();
        }
        this.ee.emit('status', 'stopped');
    }

    private spawnChild() {
        this.ee.emit('status', 'starting');

        const child = spawn(this.binPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
        const startedAt = Date.now();
        this.child = child;

        const lines = readline.createInterface({ input: child.stdout });
        lines.on('line', (line) => this.handleLine(line));

        child.once('spawn', () => {
            if (this.child === child) this.ee.emit('status', 'running');
        });
        child.stderr.on('data', (data: Buffer) => {
            this.log.warn('[ContextEngine] helper:', data.toString().trim());
        });
        // Swallow EPIPE when the helper exits first
        child.stdin.on('error', () => {});

        let gone = false;
        const onGone = (reason: string) => {
            if (gone) return;
            gone = true;
            lines.close();
            if (this.child !== child) return; // stopped or replaced
            this.child = null;
            if (this.stopped) return;

            if (Date.now() - startedAt > STABLE_RUN_MS) {
                this.backoffMs = MIN_BACKOFF_MS;
            }
            this.log.warn(`[ContextEngine] helper ${reason}, restart in ${this.backoffMs / 1000}s`);
            this.ee.emit('status', 'starting');
            this.restartTimer = setTimeout(() => {
                this.restartTimer = null;
                if (!this.stopped) this.spawnChild();
            }, this.backoffMs);
            this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
        };

        child.on('error', (err) => onGone(`failed (${err.message})`));
        child.on('exit', (code, signal) => onGone(`exited (code ${code}, signal ${signal})`));
    }

    private handleLine(line: string) {
        let msg: any;
        try {
            msg = JSON.parse(line);
        } catch {
            this.log.warn('[ContextEngine] helper: bad line', line);
            return;
        }
        if (msg?.type === 'app' && typeof msg.bundleId === 'string') {
            const info = { bundleId: msg.bundleId, name: String(msg.name ?? '') };
            this.ee.emit('app', info, Number(msg.pid) || 0);
        } else if (msg?.type === 'mic' && typeof msg.inUse === 'boolean') {
            this.ee.emit('mic', msg.inUse);
        }
    }
}
