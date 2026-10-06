/** IPC 通道 */
export const IPC = {
    /** renderer → main (invoke): current IContextEngineState */
    GET_STATE: '@infra/context-engine/get-state',
    /** renderer → main (invoke): lock a context id, or null to unlock */
    SET_MANUAL_OVERRIDE: '@infra/context-engine/set-manual-override',
    /** main → all windows: IContextEngineState changed */
    STATE_UPDATED: '@infra/context-engine/state-updated',
    /** main → all windows: IContextChange committed */
    CONTEXT_CHANGED: '@infra/context-engine/context-changed',
} as const;

/** contextBridge key */
export const CONTEXT_BRIDGE_KEY = '@infra/context-engine';
