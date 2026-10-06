/**
 * contextEngine — resolver (pure)
 *
 * No Electron or Node imports: plain node can run it (see scripts/test-context-resolver.ts).
 *
 * 1. matchRules(): signals + ordered rules → first matching rule (or null).
 * 2. step(): state machine that decides when a new target context is committed.
 *
 * Commit policy, in order:
 *   - manualOverride set → commit at once (wins over everything).
 *   - urgent transition: the target starts or stops being a 'mic' match → commit at once.
 *     (This also fires when the context id stays the same, so the player can start or stop
 *     ducking.)
 *   - leaving a context that came from 'manual', 'mic' or 'idle' → commit at once
 *     (the user came back or unlocked; latency matters more than stability).
 *   - otherwise the target must stay the same for `debounceSec`, AND `minDwellSec` must have
 *     passed since the last commit. The 'initial' commit is provisional (often made while the
 *     player itself is frontmost): leaving it needs the debounce only.
 */
import type {
    ContextChangeReason,
    ContextRuleKind,
    IContextCandidate,
    IContextChange,
    IContextDef,
    IContextRule,
    IContextRuleMatch,
    IContextSignals,
} from '@appTypes/infra/contextEngine';

// ─── Rule matching ───

export interface IRuleMatchResult {
    contextId: string;
    ruleId: string;
    ruleKind: ContextRuleKind;
}

/** 'HH:MM' → minutes since midnight, or null when invalid */
export function parseClock(value: string): number | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? '');
    if (!m) return null;
    const hours = Number(m[1]);
    const minutes = Number(m[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
}

/**
 * Local time in [from, to). `from > to` wraps past midnight; the after-midnight part counts
 * for the previous day in `days`. `from === to` means the whole day.
 */
function matchTime(match: Extract<IContextRuleMatch, { kind: 'time' }>, now: number): boolean {
    const from = parseClock(match.from);
    const to = parseClock(match.to);
    if (from === null || to === null) return false;

    const date = new Date(now);
    const minutes = date.getHours() * 60 + date.getMinutes();
    const day = date.getDay();
    const dayOk = (d: number) => !match.days?.length || match.days.includes(d);

    if (from === to) return dayOk(day);
    if (from < to) return minutes >= from && minutes < to && dayOk(day);
    if (minutes >= from) return dayOk(day);
    if (minutes < to) return dayOk((day + 6) % 7);
    return false;
}

export function matchRule(signals: IContextSignals, match: IContextRuleMatch): boolean {
    switch (match.kind) {
        case 'app': {
            const bundleId = signals.app?.bundleId?.toLowerCase();
            if (!bundleId) return false;
            return match.bundleIds.some((id) => id.toLowerCase() === bundleId);
        }
        case 'idle':
            return signals.idleSec >= match.minSec;
        case 'mic':
            return signals.micInUse;
        case 'time':
            return matchTime(match, signals.now);
        default:
            return false;
    }
}

/** First enabled rule that matches, or null */
export function matchRules(
    signals: IContextSignals,
    rules: IContextRule[],
): IRuleMatchResult | null {
    for (const rule of rules) {
        if (rule.enabled === false) continue;
        if (matchRule(signals, rule.match)) {
            return { contextId: rule.contextId, ruleId: rule.id, ruleKind: rule.match.kind };
        }
    }
    return null;
}

/** Drop rules that are malformed or point to an unknown context */
export function sanitizeRules(rules: unknown, contexts: IContextDef[]): IContextRule[] {
    if (!Array.isArray(rules)) return [];
    const ids = new Set(contexts.map((c) => c.id));
    return rules.filter((rule): rule is IContextRule => {
        if (!rule || typeof rule !== 'object') return false;
        const { id, contextId, match } = rule as Partial<IContextRule>;
        if (typeof id !== 'string' || typeof contextId !== 'string' || !ids.has(contextId)) {
            return false;
        }
        if (!match || typeof match !== 'object') return false;
        switch (match.kind) {
            case 'app':
                return Array.isArray(match.bundleIds);
            case 'idle':
                return typeof match.minSec === 'number';
            case 'mic':
                return true;
            case 'time':
                return typeof match.from === 'string' && typeof match.to === 'string';
            default:
                return false;
        }
    });
}

// ─── State machine ───

export interface IResolverOptions {
    debounceSec: number;
    minDwellSec: number;
    /** Used when no rule matches */
    defaultContextId: string;
    /** Locked context, or null */
    manualOverride: string | null;
}

/** What currently justifies a context (target of one evaluation) */
export interface IResolverTarget {
    contextId: string;
    reason: Exclude<ContextChangeReason, 'initial'>;
    ruleId: string | null;
    ruleKind: ContextRuleKind | null;
}

export interface IResolverState {
    /** Last commit, null before the first one */
    current: IContextChange | null;
    /** Latest target that agreed with `current` (may differ from the commit's reason) */
    basis: IResolverTarget | null;
    /** Pending target, waiting for debounce / dwell */
    candidate: IContextCandidate | null;
}

export interface IStepResult {
    state: IResolverState;
    /** Set when this step committed a context */
    commit: IContextChange | null;
    /** When to call step() again to re-check a pending candidate (epoch ms), or null */
    wakeAt: number | null;
}

export const INITIAL_RESOLVER_STATE: IResolverState = {
    current: null,
    basis: null,
    candidate: null,
};

export function resolveTarget(
    signals: IContextSignals,
    rules: IContextRule[],
    options: IResolverOptions,
): IResolverTarget {
    if (options.manualOverride) {
        return {
            contextId: options.manualOverride,
            reason: 'manual',
            ruleId: null,
            ruleKind: null,
        };
    }
    const match = matchRules(signals, rules);
    if (match) {
        return { ...match, reason: 'rule' };
    }
    return {
        contextId: options.defaultContextId,
        reason: 'fallback',
        ruleId: null,
        ruleKind: null,
    };
}

/** Kinds whose context is left at once when the target changes */
function isInterrupt(basis: IResolverTarget | null): boolean {
    return basis?.reason === 'manual' || basis?.ruleKind === 'mic' || basis?.ruleKind === 'idle';
}

/** One evaluation. Pure: returns the next state, never mutates its input. */
export function step(
    state: IResolverState,
    signals: IContextSignals,
    rules: IContextRule[],
    options: IResolverOptions,
): IStepResult {
    const now = signals.now;
    const target = resolveTarget(signals, rules, options);
    const targetUrgent = target.ruleKind === 'mic';
    const current = state.current;

    const commit = (): IStepResult => {
        const change: IContextChange = {
            contextId: target.contextId,
            previousId: current?.contextId ?? null,
            reason: current ? target.reason : 'initial',
            ruleId: target.ruleId,
            ruleKind: target.ruleKind,
            urgent: targetUrgent,
            at: now,
        };
        return {
            state: { current: change, basis: target, candidate: null },
            commit: change,
            wakeAt: null,
        };
    };

    if (!current) return commit();

    if (target.contextId === current.contextId) {
        if (current.urgent !== targetUrgent) return commit();
        return {
            state: { current, basis: target, candidate: null },
            commit: null,
            wakeAt: null,
        };
    }

    if (target.reason === 'manual' || targetUrgent || current.urgent || isInterrupt(state.basis)) {
        return commit();
    }

    const candidate: IContextCandidate =
        state.candidate?.contextId === target.contextId
            ? { ...target, since: state.candidate.since }
            : { ...target, since: now };

    const debounceUntil = candidate.since + options.debounceSec * 1000;
    const dwellUntil = current.reason === 'initial' ? 0 : current.at + options.minDwellSec * 1000;
    const readyAt = Math.max(debounceUntil, dwellUntil);
    if (now >= readyAt) return commit();

    return {
        state: { current, basis: state.basis, candidate },
        commit: null,
        wakeAt: readyAt,
    };
}
