import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import contextEngine, { useCurrentContext } from '@infra/contextEngine/renderer';
import { ContextIcon } from '@renderer/mainWindow/components/business/ContextIcon';
import type { IContextConfig } from '@renderer/mainWindow/common/contextConfig';
import type { IContextChange, IContextEngineState } from '@appTypes/infra/contextEngine';

/** Refresh interval of the live readings (idle time is not pushed by the engine) */
const POLL_MS = 1000;

function formatCountdown(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(total / 60);
    const secs = total % 60;
    return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/** When the pending candidate will be committed (mirrors the resolver's debounce + dwell) */
function candidateReadyAt(state: IContextEngineState, config: IContextConfig): number | null {
    const { candidate, lastChange } = state;
    if (!candidate) return null;
    const debounceUntil = candidate.since + config.debounceSec * 1000;
    const dwellUntil =
        !lastChange || lastChange.reason === 'initial'
            ? 0
            : lastChange.at + config.minDwellSec * 1000;
    return Math.max(debounceUntil, dwellUntil);
}

interface StatTileProps {
    label: string;
    value: ReactNode;
    caption?: ReactNode;
}

function StatTile({ label, value, caption }: StatTileProps) {
    return (
        <div className="p-setting__context-stat">
            <div className="p-setting__context-stat-label">{label}</div>
            <div className="p-setting__context-stat-value">{value}</div>
            {caption && <div className="p-setting__context-stat-caption">{caption}</div>}
        </div>
    );
}

interface ContextStatusProps {
    config: IContextConfig;
}

/**
 * ContextStatus — live readings of the context engine: current context, pending switch,
 * frontmost app, microphone and idle time.
 */
export function ContextStatus({ config }: ContextStatusProps) {
    const { t } = useTranslation();
    const state = useCurrentContext();
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const timer = setInterval(() => {
            setNow(Date.now());
            contextEngine.getState().catch((): void => undefined);
        }, POLL_MS);
        return () => clearInterval(timer);
    }, []);

    if (!state?.enabled) {
        return <div className="p-setting__context-empty">{t('settings.context.status_off')}</div>;
    }

    const findContext = (id: string | null | undefined) =>
        id ? config.contexts.find((ctx) => ctx.id === id) : undefined;

    const reasonLabel = (change: IContextChange | null): string | undefined => {
        if (!change) return undefined;
        if (change.reason === 'manual') return t('settings.context.reason_manual');
        if (change.ruleKind) return t(`settings.context.reason_${change.ruleKind}`);
        return t('settings.context.reason_default');
    };

    const current = findContext(state.currentContextId);
    const candidate = state.candidate ? findContext(state.candidate.contextId) : undefined;
    const readyAt = candidateReadyAt(state, config);
    const { snapshot } = state;
    const isLocked = state.lastChange?.reason === 'manual';

    const idleText =
        snapshot.idleSec < 60
            ? t('settings.context.seconds_value', { count: Math.floor(snapshot.idleSec) })
            : t('settings.context.minutes_value', { count: Math.floor(snapshot.idleSec / 60) });

    return (
        <div className="p-setting__context-stats">
            <StatTile
                label={t('settings.context.status_current')}
                value={
                    current ? (
                        <span className="p-setting__context-stat-name">
                            <ContextIcon name={current.icon} size={16} />
                            <span className="p-setting__context-stat-text">{current.name}</span>
                            {isLocked && <Lock size={12} aria-hidden="true" />}
                        </span>
                    ) : (
                        t('settings.context.status_detecting')
                    )
                }
                caption={reasonLabel(state.lastChange)}
            />
            <StatTile
                label={t('settings.context.status_next')}
                value={
                    candidate ? (
                        <span className="p-setting__context-stat-name">
                            <ContextIcon name={candidate.icon} size={16} />
                            <span className="p-setting__context-stat-text">{candidate.name}</span>
                        </span>
                    ) : (
                        <span className="p-setting__context-stat-muted">
                            {t('settings.context.status_no_change')}
                        </span>
                    )
                }
                caption={
                    candidate && readyAt !== null
                        ? t('settings.context.status_switch_in', {
                              time: formatCountdown(readyAt - now),
                          })
                        : undefined
                }
            />
            <StatTile
                label={t('settings.context.status_app')}
                value={
                    snapshot.app ? (
                        <span
                            className="p-setting__context-stat-text"
                            title={snapshot.app.bundleId}
                        >
                            {snapshot.app.name || snapshot.app.bundleId}
                        </span>
                    ) : (
                        <span className="p-setting__context-stat-muted">
                            {t('settings.context.status_unknown')}
                        </span>
                    )
                }
            />
            <StatTile
                label={t('settings.context.status_mic')}
                value={
                    snapshot.micInUse ? (
                        <span className="p-setting__context-stat-live">
                            {t('settings.context.mic_in_use')}
                        </span>
                    ) : (
                        <span className="p-setting__context-stat-muted">
                            {t('settings.context.mic_not_in_use')}
                        </span>
                    )
                }
            />
            <StatTile label={t('settings.context.status_idle')} value={idleText} />
        </div>
    );
}
