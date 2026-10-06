/**
 * contextEngine — types
 *
 * Context engine: decides the current listening CONTEXT (deep work, communication, idle, ...)
 * from what the user does on the computer (frontmost app, microphone in use, idle time, clock).
 *
 * Data flow:
 *   signals (helper + powerMonitor) → matchRules → resolver state machine → IContextChange
 *   IContextChange → broadcast (all windows) + appSync command 'context-changed' (main window)
 */

// ─── Config ───

/** A context the user can listen in. Persisted in `context.contexts`. */
export interface IContextDef {
    /** Stable id, referenced by rules, overrides and change events */
    id: string;
    /** Display name (user editable) */
    name: string;
    /** Optional icon name (lucide icon id or emoji), for the settings UI */
    icon?: string;
    /** Music sheet ids to play from in this context */
    sheetIds: string[];
}

/** What a rule matches. */
export type IContextRuleMatch =
    /** Frontmost app is one of these bundle ids (case-insensitive) */
    | { kind: 'app'; bundleIds: string[] }
    /** System idle time is at least `minSec` seconds */
    | { kind: 'idle'; minSec: number }
    /** Default input device is in use (call / meeting). Commits immediately (urgent). */
    | { kind: 'mic' }
    /**
     * Local time is in [from, to). 'HH:MM', 24 h. `from > to` wraps past midnight.
     * `days`: 0 = Sunday … 6 = Saturday (day the window starts); omit = every day.
     */
    | { kind: 'time'; from: string; to: string; days?: number[] };

export type ContextRuleKind = IContextRuleMatch['kind'];

/** Ordered rule; the first rule that matches wins. Persisted in `context.rules`. */
export interface IContextRule {
    id: string;
    contextId: string;
    match: IContextRuleMatch;
    /** Default true. Disabled rules are skipped. */
    enabled?: boolean;
}

/** What to do with playback while the microphone is in use */
export type ContextMeetingAction = 'duck' | 'pause' | 'none';

// ─── Signals ───

export interface IContextAppInfo {
    /** e.g. 'com.apple.dt.Xcode' */
    bundleId: string;
    /** Localized app name, e.g. 'Xcode' */
    name: string;
}

/** One reading of all signals. */
export interface IContextSignals {
    /** Frontmost app (undefined when the helper is not running) */
    app?: IContextAppInfo;
    /** Default input device in use by any process */
    micInUse: boolean;
    /** System idle time (seconds) */
    idleSec: number;
    /** Reading time, epoch ms (a number so it survives IPC and JSON unchanged) */
    now: number;
}

// ─── Resolver output ───

/**
 * Why a context was committed.
 * - initial: first commit after the engine started (no debounce)
 * - rule: a rule matched (`ruleId` is set)
 * - fallback: no rule matched, `context.defaultContextId` was used
 * - manual: `context.manualOverride` is set
 */
export type ContextChangeReason = 'initial' | 'rule' | 'fallback' | 'manual';

/** Emitted once per commit. Payload of the push event and the 'context-changed' command. */
export interface IContextChange {
    contextId: string;
    /** null on the first commit after start */
    previousId: string | null;
    reason: ContextChangeReason;
    /** Rule that matched, null for fallback / manual */
    ruleId: string | null;
    /** Kind of the matched rule, null for fallback / manual */
    ruleKind: ContextRuleKind | null;
    /**
     * true = interrupt (microphone / meeting). Committed without debounce or dwell.
     * The player should react at once (duck / pause per `context.meetingAction`).
     */
    urgent: boolean;
    /** Commit time, epoch ms */
    at: number;
}

/** A context that is waiting for its debounce / dwell time before commit. */
export interface IContextCandidate {
    contextId: string;
    reason: ContextChangeReason;
    ruleId: string | null;
    ruleKind: ContextRuleKind | null;
    /** First time this candidate was seen, epoch ms */
    since: number;
}

// ─── Engine state (IPC) ───

/**
 * - running: helper process is alive
 * - starting: spawned or waiting to restart after a crash
 * - unavailable: not macOS, or the binary is missing (engine uses idle + time only)
 * - stopped: engine disabled
 */
export type ContextHelperStatus = 'running' | 'starting' | 'unavailable' | 'stopped';

export interface IContextEngineState {
    /** Mirrors `context.enabled` */
    enabled: boolean;
    /** Committed context, null when disabled or before the first commit */
    currentContextId: string | null;
    /** Last commit, null when disabled */
    lastChange: IContextChange | null;
    /** Pending change, null when none */
    candidate: IContextCandidate | null;
    /** Latest signal reading */
    snapshot: IContextSignals;
    /** Distinct apps seen since start, most recent first (max 30). For the app picker. */
    recentApps: IContextAppInfo[];
    helperStatus: ContextHelperStatus;
}

/**
 * Main-process capability interface, for other infra modules that receive the engine via
 * setup injection.
 */
export interface IContextEngineReader {
    getState(): IContextEngineState;
    onContextChanged(cb: (change: IContextChange) => void): () => void;
}
