/**
 * contextEngine — Preload 层
 *
 * 通过 contextBridge 暴露情境引擎的状态查询、手动锁定和推送事件。
 *
 * 暴露名称：'@infra/context-engine'
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { IContextChange, IContextEngineState } from '@appTypes/infra/contextEngine';
import { IPC, CONTEXT_BRIDGE_KEY } from './common/constant';

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
    const handler = (_event: unknown, payload: T) => callback(payload);
    ipcRenderer.on(channel, handler);
    return () => {
        ipcRenderer.removeListener(channel, handler);
    };
}

const mod = {
    getState: (): Promise<IContextEngineState> => ipcRenderer.invoke(IPC.GET_STATE),

    setManualOverride: (contextId: string | null): Promise<void> =>
        ipcRenderer.invoke(IPC.SET_MANUAL_OVERRIDE, contextId),

    onStateUpdated: (callback: (state: IContextEngineState) => void) =>
        subscribe(IPC.STATE_UPDATED, callback),

    onContextChanged: (callback: (change: IContextChange) => void) =>
        subscribe(IPC.CONTEXT_CHANGED, callback),
};

contextBridge.exposeInMainWorld(CONTEXT_BRIDGE_KEY, mod);
