/**
 * contextEngine — 渲染进程层
 *
 * 调用方：
 *   - `contextEngine.setup()` 初始化（主窗口 bootstrap 中一次）
 *   - `contextEngine.getState()` / `contextEngine.setManualOverride(id | null)`
 *   - `contextEngine.onContextChanged(cb)` 订阅情境切换（返回取消函数）
 *   - `useCurrentContext()` 在 React 中消费引擎状态
 *
 * 情境定义、规则等配置项通过 appConfig（`context.*`，可用 useConfigValue）读写。
 */
import { atom, getDefaultStore } from 'jotai';
import { useAtomValue } from 'jotai/react';

import type { IContextChange, IContextEngineState } from '@appTypes/infra/contextEngine';
import { CONTEXT_BRIDGE_KEY } from './common/constant';

// ─── Preload Bridge ───

interface IMod {
    getState(): Promise<IContextEngineState>;
    setManualOverride(contextId: string | null): Promise<void>;
    onStateUpdated(callback: (state: IContextEngineState) => void): () => void;
    onContextChanged(callback: (change: IContextChange) => void): () => void;
}

const mod = window[CONTEXT_BRIDGE_KEY as any] as unknown as IMod;

// ─── State (Jotai) ───

const defaultStore = getDefaultStore();

/** 引擎状态；setup 完成前为 null */
const contextStateAtom = atom(null as IContextEngineState | null);

// ─── 模块实现 ───

class ContextEngineRenderer {
    private isSetup = false;

    public async setup() {
        if (this.isSetup) return;
        this.isSetup = true;

        mod.onStateUpdated((state) => {
            defaultStore.set(contextStateAtom, state);
        });
        defaultStore.set(contextStateAtom, await mod.getState());
    }

    /** 从主进程拉取最新状态（含实时信号快照） */
    public async getState(): Promise<IContextEngineState> {
        const state = await mod.getState();
        defaultStore.set(contextStateAtom, state);
        return state;
    }

    /** 锁定情境；传 null 恢复自动 */
    public setManualOverride(contextId: string | null): Promise<void> {
        return mod.setManualOverride(contextId);
    }

    /** 订阅情境切换（每次 commit 一次），返回取消函数 */
    public onContextChanged(callback: (change: IContextChange) => void): () => void {
        return mod.onContextChanged(callback);
    }
}

const contextEngine = new ContextEngineRenderer();

/** 消费情境引擎状态（当前情境、候选、信号快照、最近应用）；setup 前为 null */
export function useCurrentContext(): IContextEngineState | null {
    return useAtomValue(contextStateAtom);
}

export default contextEngine;
