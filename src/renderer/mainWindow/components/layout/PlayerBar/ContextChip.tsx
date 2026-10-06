// ============================================================================
// ContextChip — current listening context (Soundtrack) in the player bar
// ============================================================================
//
// Shows the context the music follows (icon + name). Click opens a menu:
//   - Automatic: rules decide (clears the manual override)
//   - one item per context: lock it (click the locked one again to unlock)
//   - Soundtrack settings…
// Hidden when `context.enabled` is off.

import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { AudioWaveform, Check, Lock, Settings2 } from 'lucide-react';
import { cn } from '@common/cn';
import contextEngine, { useCurrentContext } from '@infra/contextEngine/renderer';
import { useContextConfig } from '@renderer/mainWindow/common/contextConfig';
import { ContextIcon } from '../../business/ContextIcon';
import { settingRoute } from '../../../routes';
import '../../ui/ContextMenu/index.scss';
import './ContextChip.scss';

/** Gap between the chip and the menu above it (px) */
const MENU_GAP = 12;

const ContextChip = memo(function ContextChip() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const config = useContextConfig();
    const state = useCurrentContext();

    const anchorRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
    const open = menuStyle !== null;

    const close = useCallback(() => setMenuStyle(null), []);

    /** Menu position: fixed, opening upwards from the chip */
    const place = useCallback((): CSSProperties | null => {
        if (!anchorRef.current) return null;
        const rect = anchorRef.current.getBoundingClientRect();
        return { left: rect.left, bottom: window.innerHeight - rect.top + MENU_GAP };
    }, []);

    const toggle = useCallback(() => {
        setMenuStyle(open ? null : place());
    }, [open, place]);

    // ── Close on outside click / Escape; follow the chip on resize ──
    useEffect(() => {
        if (!open) return;
        const onMouseDown = (e: MouseEvent) => {
            const target = e.target as Node;
            if (!menuRef.current?.contains(target) && !anchorRef.current?.contains(target)) {
                close();
            }
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close();
        };
        document.addEventListener('mousedown', onMouseDown, true);
        document.addEventListener('keydown', onKeyDown);
        const onResize = () => setMenuStyle(place());
        window.addEventListener('resize', onResize);
        return () => {
            document.removeEventListener('mousedown', onMouseDown, true);
            document.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('resize', onResize);
        };
    }, [open, close, place]);

    if (!config.enabled) return null;

    const override = config.manualOverride;
    const currentId = state?.currentContextId ?? override ?? config.defaultContextId;
    const current = config.contexts.find((ctx) => ctx.id === currentId);
    const name = current?.name ?? t('settings.section_name.context');
    const title = override ? t('context.locked_to', { name }) : t('context.following', { name });

    const lock = (id: string | null) => {
        contextEngine.setManualOverride(id).catch((): void => undefined);
        close();
    };

    return (
        <div ref={anchorRef} className="l-player-bar__context">
            <button
                type="button"
                className={cn(
                    'l-player-bar__context-chip',
                    open && 'is-open',
                    override && 'is-locked',
                )}
                title={title}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={toggle}
            >
                <ContextIcon
                    name={current?.icon}
                    size={14}
                    className="l-player-bar__context-icon"
                />
                <span className="l-player-bar__context-name">{name}</span>
                {override && <Lock size={11} className="l-player-bar__context-lock" />}
            </button>

            {open && (
                <div
                    ref={menuRef}
                    className="context-menu l-player-bar__context-menu"
                    style={menuStyle}
                    role="menu"
                >
                    <div className="l-player-bar__context-menu-title">
                        {t('settings.section_name.context')}
                    </div>
                    <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={!override}
                        className="context-menu__item"
                        onClick={() => lock(null)}
                    >
                        <span className="context-menu__item-icon">
                            <AudioWaveform />
                        </span>
                        <span className="context-menu__item-label">{t('context.automatic')}</span>
                        {!override && <Check size={14} className="l-player-bar__context-mark" />}
                    </button>
                    <div className="context-menu__divider" />
                    {config.contexts.map((ctx) => {
                        const isLocked = override === ctx.id;
                        const isCurrent = !override && state?.currentContextId === ctx.id;
                        return (
                            <button
                                key={ctx.id}
                                type="button"
                                role="menuitemradio"
                                aria-checked={isLocked}
                                className="context-menu__item"
                                title={
                                    isLocked
                                        ? t('context.unlock')
                                        : t('context.lock_to', { name: ctx.name })
                                }
                                onClick={() => lock(isLocked ? null : ctx.id)}
                            >
                                <span className="context-menu__item-icon">
                                    <ContextIcon name={ctx.icon} />
                                </span>
                                <span className="context-menu__item-label">{ctx.name}</span>
                                {isLocked && (
                                    <Lock size={13} className="l-player-bar__context-mark" />
                                )}
                                {isCurrent && (
                                    <span
                                        className="l-player-bar__context-now"
                                        aria-label={t('context.now')}
                                    />
                                )}
                            </button>
                        );
                    })}
                    <div className="context-menu__divider" />
                    <button
                        type="button"
                        role="menuitem"
                        className="context-menu__item"
                        onClick={() => {
                            close();
                            navigate(settingRoute('context'));
                        }}
                    >
                        <span className="context-menu__item-icon">
                            <Settings2 />
                        </span>
                        <span className="context-menu__item-label">
                            {t('context.open_settings')}
                        </span>
                    </button>
                </div>
            )}
        </div>
    );
});

export default ContextChip;
