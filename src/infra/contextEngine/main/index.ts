/**
 * contextEngine — 主进程层
 *
 * Decides the current listening context from what the user does on the computer.
 *
 * - Signals: native helper (frontmost app, mic in use; macOS only) + powerMonitor idle time.
 * - Resolver: ./resolver.ts (pure): ordered rules, debounce, dwell, urgent, manual override.
 * - Output on commit: broadcast IPC.CONTEXT_CHANGED to all windows, appSync command
 *   'context-changed' to the main window, and main-process listeners (onContextChanged).
 * - Follows `context.enabled` live: starts / stops the helper and timers.
 */
import { app, ipcMain, powerMonitor } from 'electron';
import EventEmitter from 'eventemitter3';
import logger from '@infra/logger/main';
import type { IWindowManager } from '@appTypes/main/windowManager';
import type { IAppConfig, IAppConfigReader } from '@appTypes/infra/appConfig';
import type { ICommandSender } from '@appTypes/infra/appSync';
import type {
    ContextHelperStatus,
    IContextAppInfo,
    IContextChange,
    IContextDef,
    IContextEngineReader,
    IContextEngineState,
    IContextRule,
    IContextSignals,
} from '@appTypes/infra/contextEngine';
import { IPC } from '../common/constant';
import {
    DEFAULT_CONTEXT_ID,
    DEFAULT_CONTEXTS,
    DEFAULT_DEBOUNCE_SEC,
    DEFAULT_MIN_DWELL_SEC,
    DEFAULT_RULES,
} from '../common/defaults';
import {
    INITIAL_RESOLVER_STATE,
    sanitizeRules,
    step,
    type IResolverOptions,
    type IResolverState,
} from './resolver';
import { resolveHelperPath, SignalHelperProcess } from './signalHelper';

/** Idle time poll interval */
const IDLE_POLL_MS = 10 * 1000;
/** Max wait for the helper's first app line before the initial commit */
const FIRST_APP_TIMEOUT_MS = 2000;
const MAX_RECENT_APPS = 30;

interface IContextEngineDeps {
    windowManager: IWindowManager;
    appConfig: IAppConfigReader & { setConfig(data: IAppConfig): unknown };
    commandSender: ICommandSender;
}

class ContextEngine implements IContextEngineReader {
    private deps!: IContextEngineDeps;
    private isSetup = false;
    private running = false;

    private helper: SignalHelperProcess | null = null;
    private helperStatus: ContextHelperStatus = 'stopped';
    private awaitingFirstApp = false;

    private app: IContextAppInfo | undefined;
    private micInUse = false;
    private idleSec = 0;
    private recentApps: IContextAppInfo[] = [];

    private resolverState: IResolverState = INITIAL_RESOLVER_STATE;

    private idleTimer: ReturnType<typeof setInterval> | null = null;
    private wakeTimer: ReturnType<typeof setTimeout> | null = null;
    private firstAppTimer: ReturnType<typeof setTimeout> | null = null;

    private ee = new EventEmitter<{ changed: [IContextChange] }>();

    public setup(deps: IContextEngineDeps) {
        if (this.isSetup) return;
        this.deps = deps;

        ipcMain.handle(IPC.GET_STATE, () => this.getState());
        ipcMain.handle(IPC.SET_MANUAL_OVERRIDE, (_evt, contextId: string | null) => {
            this.setManualOverride(contextId);
        });

        deps.appConfig.onConfigUpdated((patch) => this.handleConfigPatch(patch));

        this.isSetup = true;

        if (this.readEnabled()) {
            this.start();
        }
    }

    public dispose() {
        this.stop();
    }

    public getState(): IContextEngineState {
        const { current, candidate } = this.resolverState;
        return {
            enabled: this.running,
            currentContextId: current?.contextId ?? null,
            lastChange: current,
            candidate,
            snapshot: this.readSignals(),
            recentApps: [...this.recentApps],
            helperStatus: this.helperStatus,
        };
    }

    /** Main-process listener for commits. Returns an unsubscribe function. */
    public onContextChanged(cb: (change: IContextChange) => void): () => void {
        this.ee.on('changed', cb);
        return () => {
            this.ee.off('changed', cb);
        };
    }

    /** Lock a context (persisted in `context.manualOverride`), or null to go back to rules */
    public setManualOverride(contextId: string | null) {
        const valid = contextId === null || this.readContexts().some((ctx) => ctx.id === contextId);
        if (!valid) {
            logger.warn('[ContextEngine] unknown context for manual override', contextId);
            return;
        }
        // The config listener re-evaluates.
        this.deps.appConfig.setConfig({ 'context.manualOverride': contextId });
    }

    // ─── Lifecycle ───

    private start() {
        if (this.running) return;
        this.running = true;
        this.resolverState = INITIAL_RESOLVER_STATE;
        this.app = undefined;
        this.micInUse = false;

        this.startHelper();

        this.readIdle();
        this.idleTimer = setInterval(() => {
            this.readIdle();
            this.evaluate();
        }, IDLE_POLL_MS);

        logger.info('[ContextEngine] started', { helper: this.helperStatus });

        if (this.awaitingFirstApp) {
            // Wait for the frontmost app, so the initial commit is not a blind fallback.
            this.firstAppTimer = setTimeout(() => {
                this.firstAppTimer = null;
                this.awaitingFirstApp = false;
                this.evaluate(true);
            }, FIRST_APP_TIMEOUT_MS);
        } else {
            this.evaluate(true);
        }
    }

    private stop() {
        if (!this.running) return;
        this.running = false;

        this.helper?.stop();
        this.helperStatus = 'stopped';
        this.awaitingFirstApp = false;

        if (this.idleTimer) clearInterval(this.idleTimer);
        if (this.firstAppTimer) clearTimeout(this.firstAppTimer);
        if (this.wakeTimer) clearTimeout(this.wakeTimer);
        this.idleTimer = null;
        this.firstAppTimer = null;
        this.wakeTimer = null;

        this.resolverState = INITIAL_RESOLVER_STATE;
        logger.info('[ContextEngine] stopped');
        this.broadcastState();
    }

    private startHelper() {
        if (!this.helper) {
            const binPath = resolveHelperPath(app.isPackaged, app.getAppPath());
            if (!binPath) {
                this.helperStatus = 'unavailable';
                logger.warn(
                    process.platform === 'darwin'
                        ? '[ContextEngine] context-helper binary missing ' +
                              '(run scripts/build-context-helper.sh); using idle + time only'
                        : '[ContextEngine] no signal helper on this platform; ' +
                              'using idle + time only',
                );
                return;
            }
            this.helper = new SignalHelperProcess(binPath, logger);
            this.helper.on('status', (status) => {
                if (this.running) this.helperStatus = status;
            });
            this.helper.on('app', (info, pid) => this.handleApp(info, pid));
            this.helper.on('mic', (inUse) => this.handleMic(inUse));
        }
        this.awaitingFirstApp = true;
        this.helper.start();
    }

    // ─── Signals ───

    private handleApp(info: IContextAppInfo, pid: number) {
        if (!this.running) return;
        // Opening the player itself must not change the context: keep the previous app.
        // (At start the player is usually frontmost: the first-app timeout handles that.)
        if (pid === process.pid) return;

        this.app = info;
        if (info.bundleId) {
            this.recentApps = [
                info,
                ...this.recentApps.filter((item) => item.bundleId !== info.bundleId),
            ].slice(0, MAX_RECENT_APPS);
        }

        if (this.releaseFirstApp()) return;
        this.evaluate(true);
    }

    private handleMic(inUse: boolean) {
        if (!this.running || inUse === this.micInUse) return;
        this.micInUse = inUse;
        logger.info('[ContextEngine] mic in use:', inUse);
        this.evaluate(true);
    }

    /** End the wait for the first app line. Returns true when it did the initial evaluate. */
    private releaseFirstApp(): boolean {
        if (!this.awaitingFirstApp) return false;
        this.awaitingFirstApp = false;
        if (this.firstAppTimer) {
            clearTimeout(this.firstAppTimer);
            this.firstAppTimer = null;
        }
        this.evaluate(true);
        return true;
    }

    private readIdle() {
        try {
            this.idleSec = powerMonitor.getSystemIdleTime();
        } catch {
            this.idleSec = 0;
        }
    }

    private readSignals(): IContextSignals {
        return {
            app: this.app,
            micInUse: this.micInUse,
            idleSec: this.idleSec,
            now: Date.now(),
        };
    }

    // ─── Resolve ───

    /**
     * Run one resolver step and publish the result.
     * @param signalChanged broadcast state even when nothing was committed (app list changed)
     */
    private evaluate(signalChanged = false) {
        if (!this.running || this.awaitingFirstApp) return;

        const { rules, options } = this.readResolverConfig();
        const prevCandidate = this.resolverState.candidate;
        const result = step(this.resolverState, this.readSignals(), rules, options);
        this.resolverState = result.state;

        if (this.wakeTimer) {
            clearTimeout(this.wakeTimer);
            this.wakeTimer = null;
        }
        if (result.wakeAt !== null) {
            this.wakeTimer = setTimeout(
                () => {
                    this.wakeTimer = null;
                    this.readIdle();
                    this.evaluate();
                },
                Math.max(0, result.wakeAt - Date.now()) + 50,
            );
        }

        if (result.commit) {
            this.publish(result.commit);
        }

        const candidate = result.state.candidate;
        const candidateChanged =
            prevCandidate?.contextId !== candidate?.contextId ||
            prevCandidate?.since !== candidate?.since;
        if (result.commit || candidateChanged || signalChanged) {
            this.broadcastState();
        }
    }

    private publish(change: IContextChange) {
        logger.info('[ContextEngine] commit', change);
        this.deps.windowManager.broadcast(IPC.CONTEXT_CHANGED, change);
        this.deps.commandSender.sendCommand('context-changed', change);
        this.ee.emit('changed', change);
    }

    private broadcastState() {
        this.deps.windowManager.broadcast(IPC.STATE_UPDATED, this.getState());
    }

    // ─── Config ───

    private handleConfigPatch(patch: IAppConfig) {
        // Read `enabled` on every patch: resetConfig() sends an empty patch.
        const enabled = this.readEnabled();
        if (enabled !== this.running) {
            if (enabled) {
                this.start();
            } else {
                this.stop();
            }
            return;
        }
        if (this.running && Object.keys(patch).some((key) => key.startsWith('context.'))) {
            this.evaluate(true);
        }
    }

    private readEnabled(): boolean {
        return this.deps.appConfig.getConfigByKey('context.enabled') === true;
    }

    private readContexts(): IContextDef[] {
        const contexts = this.deps.appConfig.getConfigByKey('context.contexts');
        return Array.isArray(contexts) && contexts.length ? contexts : DEFAULT_CONTEXTS;
    }

    private readResolverConfig(): { rules: IContextRule[]; options: IResolverOptions } {
        const config = this.deps.appConfig;
        const contexts = this.readContexts();
        const has = (id: unknown): id is string =>
            typeof id === 'string' && contexts.some((ctx) => ctx.id === id);
        const seconds = (value: unknown, fallback: number) =>
            typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;

        const defaultContextId = config.getConfigByKey('context.defaultContextId');
        const manualOverride = config.getConfigByKey('context.manualOverride');

        return {
            rules: sanitizeRules(config.getConfigByKey('context.rules') ?? DEFAULT_RULES, contexts),
            options: {
                debounceSec: seconds(
                    config.getConfigByKey('context.debounceSec'),
                    DEFAULT_DEBOUNCE_SEC,
                ),
                minDwellSec: seconds(
                    config.getConfigByKey('context.minDwellSec'),
                    DEFAULT_MIN_DWELL_SEC,
                ),
                defaultContextId: has(defaultContextId)
                    ? defaultContextId
                    : has(DEFAULT_CONTEXT_ID)
                      ? DEFAULT_CONTEXT_ID
                      : contexts[0].id,
                manualOverride: has(manualOverride) ? manualOverride : null,
            },
        };
    }
}

const contextEngine = new ContextEngine();
export default contextEngine;
