/**
 * contextConfig — read and write the `context.*` app config from the main window.
 *
 * Used by the Soundtrack settings section and the player bar context chip.
 * All writes go through appConfig; the context engine (main process) reacts to the patch.
 *
 * Invariants kept on every write:
 *   - at least one context; context ids are unique
 *   - `context.defaultContextId` names an existing context
 *   - rules have unique ids and point to an existing context
 *   - `context.manualOverride` is null or an existing context
 */
import { useMemo } from 'react';
import appConfig from '@infra/appConfig/renderer';
import { useConfigValue } from '@renderer/common/hooks/useConfigValue';
import {
    DEFAULT_CONTEXT_ID,
    DEFAULT_CONTEXTS,
    DEFAULT_DEBOUNCE_SEC,
    DEFAULT_MIN_DWELL_SEC,
    DEFAULT_RULES,
} from '@infra/contextEngine/common/defaults';
import type { IAppConfig } from '@appTypes/infra/appConfig';
import type {
    ContextMeetingAction,
    ContextRuleKind,
    IContextDef,
    IContextRule,
    IContextRuleMatch,
} from '@appTypes/infra/contextEngine';

export interface IContextConfig {
    enabled: boolean;
    contexts: IContextDef[];
    rules: IContextRule[];
    defaultContextId: string;
    debounceSec: number;
    minDwellSec: number;
    meetingAction: ContextMeetingAction;
    manualOverride: string | null;
}

// ─── Pure helpers ───

/** Short unique id with a readable prefix, e.g. 'ctx-lq3k9f2a7x' */
export function createId(prefix: 'ctx' | 'rule'): string {
    return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
    const seen = new Set<string>();
    return items.filter((item) => {
        if (!item.id || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
    });
}

function pickDefaultId(contexts: IContextDef[], wanted: unknown): string {
    if (typeof wanted === 'string' && contexts.some((ctx) => ctx.id === wanted)) return wanted;
    if (contexts.some((ctx) => ctx.id === DEFAULT_CONTEXT_ID)) return DEFAULT_CONTEXT_ID;
    return contexts[0].id;
}

function seconds(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Normalize raw config values (missing keys fall back to the engine defaults). */
export function normalizeContextConfig(raw: Partial<IAppConfig>): IContextConfig {
    const rawContexts = raw['context.contexts'];
    const contexts = uniqueById(
        Array.isArray(rawContexts) && rawContexts.length ? rawContexts : DEFAULT_CONTEXTS,
    );
    const ids = new Set(contexts.map((ctx) => ctx.id));
    const rawRules = raw['context.rules'];
    const rules = uniqueById(Array.isArray(rawRules) ? rawRules : DEFAULT_RULES);
    const override = raw['context.manualOverride'];
    const meetingAction = raw['context.meetingAction'];

    return {
        enabled: raw['context.enabled'] === true,
        contexts,
        rules,
        defaultContextId: pickDefaultId(contexts, raw['context.defaultContextId']),
        debounceSec: seconds(raw['context.debounceSec'], DEFAULT_DEBOUNCE_SEC),
        minDwellSec: seconds(raw['context.minDwellSec'], DEFAULT_MIN_DWELL_SEC),
        meetingAction:
            meetingAction === 'pause' || meetingAction === 'none' ? meetingAction : 'duck',
        manualOverride: typeof override === 'string' && ids.has(override) ? override : null,
    };
}

/** Default match for a rule kind (used when a rule changes kind or is created) */
export function defaultMatch(kind: ContextRuleKind): IContextRuleMatch {
    switch (kind) {
        case 'app':
            return { kind: 'app', bundleIds: [] };
        case 'idle':
            return { kind: 'idle', minSec: 300 };
        case 'mic':
            return { kind: 'mic' };
        case 'time':
            return { kind: 'time', from: '09:00', to: '17:00' };
    }
}

// ─── Pending writes ───
//
// appConfig.setConfig() is async: the renderer cache changes only when main echoes the patch.
// Writes made before the echo (fast clicks) would read stale values and drop earlier edits,
// so keep our own writes in an overlay until main echoes them back.

let pending: IAppConfig = {};
const pendingCount = new Map<string, number>();

appConfig.onConfigUpdated((patch, _config, source) => {
    if (source !== 'renderer') return;
    for (const key of Object.keys(patch)) {
        const count = (pendingCount.get(key) ?? 0) - 1;
        if (count > 0) {
            pendingCount.set(key, count);
        } else if (pendingCount.has(key)) {
            pendingCount.delete(key);
            delete (pending as Record<string, unknown>)[key];
        }
    }
});

function writeConfig(patch: IAppConfig) {
    pending = { ...pending, ...patch };
    for (const key of Object.keys(patch)) {
        pendingCount.set(key, (pendingCount.get(key) ?? 0) + 1);
    }
    appConfig.setConfig(patch);
}

// ─── Reads ───

/** Current `context.*` config (including writes not yet echoed by main), normalized */
export function readContextConfig(): IContextConfig {
    const config = appConfig.getConfig() as Partial<IAppConfig>;
    return normalizeContextConfig({ ...config, ...pending });
}

/** Subscribe to the `context.*` config (normalized). */
export function useContextConfig(): IContextConfig {
    const [enabled] = useConfigValue('context.enabled');
    const [contexts] = useConfigValue('context.contexts');
    const [rules] = useConfigValue('context.rules');
    const [defaultContextId] = useConfigValue('context.defaultContextId');
    const [debounceSec] = useConfigValue('context.debounceSec');
    const [minDwellSec] = useConfigValue('context.minDwellSec');
    const [meetingAction] = useConfigValue('context.meetingAction');
    const [manualOverride] = useConfigValue('context.manualOverride');

    return useMemo(
        () =>
            normalizeContextConfig({
                'context.enabled': enabled,
                'context.contexts': contexts,
                'context.rules': rules,
                'context.defaultContextId': defaultContextId,
                'context.debounceSec': debounceSec,
                'context.minDwellSec': minDwellSec,
                'context.meetingAction': meetingAction,
                'context.manualOverride': manualOverride,
            }),
        [
            enabled,
            contexts,
            rules,
            defaultContextId,
            debounceSec,
            minDwellSec,
            meetingAction,
            manualOverride,
        ],
    );
}

// ─── Writes ───

/** Save the context list. Ignored when it would leave no context. */
export function saveContexts(next: IContextDef[]) {
    const contexts = uniqueById(next).map((ctx) => ({
        ...ctx,
        name: ctx.name.trim() || ctx.id,
        sheetIds: [...new Set(ctx.sheetIds)],
    }));
    if (!contexts.length) return;

    const current = readContextConfig();
    const ids = new Set(contexts.map((ctx) => ctx.id));
    const patch: IAppConfig = {
        'context.contexts': contexts,
        'context.defaultContextId': pickDefaultId(contexts, current.defaultContextId),
    };
    if (current.manualOverride && !ids.has(current.manualOverride)) {
        patch['context.manualOverride'] = null;
    }
    writeConfig(patch);
}

/** Patch one context by id */
export function updateContext(id: string, patch: Partial<Omit<IContextDef, 'id'>>) {
    const { contexts } = readContextConfig();
    saveContexts(contexts.map((ctx) => (ctx.id === id ? { ...ctx, ...patch } : ctx)));
}

/** Append a new context and return its id */
export function addContext(name: string, icon: string): string {
    const { contexts } = readContextConfig();
    const id = createId('ctx');
    saveContexts([...contexts, { id, name, icon, sheetIds: [] }]);
    return id;
}

/**
 * Delete a context and the rules that point to it. The default context and the last context
 * can not be deleted. Returns false when nothing was deleted.
 */
export function deleteContext(id: string): boolean {
    const current = readContextConfig();
    if (id === current.defaultContextId || current.contexts.length <= 1) return false;

    const contexts = current.contexts.filter((ctx) => ctx.id !== id);
    if (contexts.length === current.contexts.length) return false;

    const patch: IAppConfig = {
        'context.contexts': contexts,
        'context.rules': current.rules.filter((rule) => rule.contextId !== id),
    };
    if (current.manualOverride === id) {
        patch['context.manualOverride'] = null;
    }
    writeConfig(patch);
    return true;
}

export function setDefaultContext(id: string) {
    const { contexts } = readContextConfig();
    if (contexts.some((ctx) => ctx.id === id)) {
        writeConfig({ 'context.defaultContextId': id });
    }
}

/** Save the ordered rule list (drops duplicates and rules for unknown contexts) */
export function saveRules(next: IContextRule[]) {
    const { contexts } = readContextConfig();
    const ids = new Set(contexts.map((ctx) => ctx.id));
    writeConfig({
        'context.rules': uniqueById(next).filter((rule) => ids.has(rule.contextId)),
    });
}

type RulePatch = Partial<Omit<IContextRule, 'id'>>;

/** Patch one rule by id. A function patch receives the latest rule (safe for fast edits). */
export function updateRule(id: string, patch: RulePatch | ((rule: IContextRule) => RulePatch)) {
    const { rules } = readContextConfig();
    saveRules(
        rules.map((rule) =>
            rule.id === id
                ? { ...rule, ...(typeof patch === 'function' ? patch(rule) : patch) }
                : rule,
        ),
    );
}

/** Move a rule to another index (first match wins, so order matters) */
export function moveRule(from: number, to: number) {
    const { rules } = readContextConfig();
    if (from === to || from < 0 || to < 0 || from >= rules.length || to >= rules.length) return;
    const next = [...rules];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    saveRules(next);
}
