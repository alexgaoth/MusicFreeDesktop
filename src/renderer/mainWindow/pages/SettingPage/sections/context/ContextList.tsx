import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Heart, ListMusic, Plus, Trash2 } from 'lucide-react';
import { cn } from '@common/cn';
import { Badge } from '@renderer/mainWindow/components/ui/Badge';
import { Button } from '@renderer/mainWindow/components/ui/Button';
import { Chip } from '@renderer/mainWindow/components/ui/Chip';
import { Input } from '@renderer/mainWindow/components/ui/Input';
import { showModal } from '@renderer/mainWindow/components/ui/Modal/modalManager';
import {
    CONTEXT_ICON_NAMES,
    ContextIcon,
} from '@renderer/mainWindow/components/business/ContextIcon';
import { normalizeHexColor } from '@common/color';
import { CONTEXT_COLOR_PALETTE } from '@infra/contextEngine/common/defaults';
import { useMusicSheetList } from '@infra/musicSheet/renderer';
import { DEFAULT_FAVORITE_SHEET_ID } from '@infra/musicSheet/common/constant';
import {
    addContext,
    deleteContext,
    readContextConfig,
    resolveContextAccent,
    resolveContextColor,
    updateContext,
    type IContextConfig,
} from '@renderer/mainWindow/common/contextConfig';
import type { IContextDef } from '@appTypes/infra/contextEngine';
import type { ILocalSheetMeta } from '@appTypes/infra/musicSheet';

// ─── Popover dismiss (outside click / Escape) ───

function usePopoverDismiss(
    open: boolean,
    close: () => void,
    wrapperRef: RefObject<HTMLDivElement | null>,
) {
    useEffect(() => {
        if (!open) return;
        const onMouseDown = (e: MouseEvent) => {
            if (!wrapperRef.current?.contains(e.target as Node)) close();
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close();
        };
        window.addEventListener('mousedown', onMouseDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open, close, wrapperRef]);
}

// ─── Icon picker ───

interface IconPickerProps {
    value?: string;
    /** Readable context accent, used for the icon on the button */
    color: string;
    onChange: (icon: string) => void;
}

function IconPicker({ value, color, onChange }: IconPickerProps) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const close = useCallback(() => setOpen(false), []);
    usePopoverDismiss(open, close, wrapperRef);

    return (
        <div ref={wrapperRef} className="p-setting__context-icon-picker">
            <button
                type="button"
                className={cn('p-setting__context-icon-btn', open && 'is-active')}
                style={{ color }}
                title={t('settings.context.choose_icon')}
                aria-label={t('settings.context.choose_icon')}
                aria-expanded={open}
                onClick={() => setOpen((prev) => !prev)}
            >
                <ContextIcon name={value} size={18} />
            </button>
            {open && (
                <div className="p-setting__context-icon-grid" role="listbox">
                    {CONTEXT_ICON_NAMES.map((name) => (
                        <button
                            key={name}
                            type="button"
                            role="option"
                            aria-selected={name === value}
                            aria-label={name}
                            title={name}
                            className={cn(
                                'p-setting__context-icon-option',
                                name === value && 'is-selected',
                            )}
                            onClick={() => {
                                onChange(name);
                                setOpen(false);
                            }}
                        >
                            <ContextIcon name={name} size={16} />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Colour picker (curated swatches + custom hex) ───

interface ColorPickerProps {
    /** Current colour, '#rrggbb' */
    value: string;
    onChange: (color: string) => void;
}

function ColorPicker({ value, onChange }: ColorPickerProps) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [hex, setHex] = useState(value);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const close = useCallback(() => setOpen(false), []);
    usePopoverDismiss(open, close, wrapperRef);

    useEffect(() => {
        if (open) setHex(value);
    }, [open, value]);

    const parsed = normalizeHexColor(hex);
    const commitHex = () => {
        if (parsed && parsed !== value) onChange(parsed);
        else if (!parsed) setHex(value);
    };

    return (
        <div ref={wrapperRef} className="p-setting__context-color-picker">
            <button
                type="button"
                className={cn('p-setting__context-color-btn', open && 'is-active')}
                title={t('settings.context.choose_color')}
                aria-label={t('settings.context.choose_color')}
                aria-expanded={open}
                onClick={() => setOpen((prev) => !prev)}
            >
                <span className="p-setting__context-color-dot" style={{ background: value }} />
            </button>
            {open && (
                <div className="p-setting__context-color-panel">
                    <div className="p-setting__context-color-grid" role="listbox">
                        {CONTEXT_COLOR_PALETTE.map((color) => (
                            <button
                                key={color}
                                type="button"
                                role="option"
                                aria-selected={color === value}
                                aria-label={color}
                                title={color}
                                className={cn(
                                    'p-setting__context-color-option',
                                    color === value && 'is-selected',
                                )}
                                style={{ background: color }}
                                onClick={() => {
                                    onChange(color);
                                    setOpen(false);
                                }}
                            >
                                {color === value && <Check size={12} strokeWidth={3} />}
                            </button>
                        ))}
                    </div>
                    <label className="p-setting__context-color-custom">
                        <span className="p-setting__context-color-custom-label">
                            {t('settings.context.custom_color')}
                        </span>
                        <Input
                            className="p-setting__context-color-input"
                            value={hex}
                            maxLength={7}
                            spellCheck={false}
                            placeholder="#7c8cff"
                            hasError={hex.trim() !== '' && !parsed}
                            prefix={
                                <span
                                    className="p-setting__context-color-dot p-setting__context-color-dot--sm"
                                    style={{ background: parsed ?? value }}
                                />
                            }
                            onChange={(e) => setHex(e.target.value)}
                            onBlur={commitHex}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') commitHex();
                            }}
                        />
                    </label>
                </div>
            )}
        </div>
    );
}

// ─── Context name input (commits on blur / Enter) ───

function ContextNameInput({ context }: { context: IContextDef }) {
    const { t } = useTranslation();
    const [text, setText] = useState(context.name);
    const focused = useRef(false);

    useEffect(() => {
        if (!focused.current) setText(context.name);
    }, [context.name]);

    const commit = useCallback(() => {
        focused.current = false;
        const name = text.trim();
        if (!name) {
            setText(context.name);
            return;
        }
        if (name !== context.name) updateContext(context.id, { name });
    }, [text, context.id, context.name]);

    return (
        <Input
            className="p-setting__context-name"
            value={text}
            maxLength={40}
            placeholder={t('settings.context.name_placeholder')}
            aria-label={t('settings.context.name_placeholder')}
            onFocus={() => {
                focused.current = true;
            }}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
        />
    );
}

// ─── One context ───

interface ContextItemProps {
    context: IContextDef;
    isDefault: boolean;
    ruleCount: number;
    sheets: ILocalSheetMeta[];
}

function ContextItem({ context, isDefault, ruleCount, sheets }: ContextItemProps) {
    const { t } = useTranslation();
    const selected = new Set(context.sheetIds);
    const knownIds = new Set(sheets.map((sheet) => sheet.id));
    const selectedCount = context.sheetIds.filter((id) => knownIds.has(id)).length;
    const color = resolveContextColor(context);

    const toggleSheet = (sheetId: string) => {
        // Read the latest value: fast clicks can arrive before the config echo re-renders us.
        const latest = readContextConfig().contexts.find((ctx) => ctx.id === context.id);
        if (!latest) return;
        // Also drops ids of playlists that no longer exist.
        const kept = latest.sheetIds.filter((id) => id !== sheetId && knownIds.has(id));
        const next = latest.sheetIds.includes(sheetId) ? kept : [...kept, sheetId];
        updateContext(context.id, { sheetIds: next });
    };

    const handleDelete = () => {
        showModal('ConfirmModal', {
            title: t('settings.context.delete_context'),
            message: t('settings.context.delete_context_confirm', { name: context.name }),
            description: ruleCount
                ? t('settings.context.delete_context_rules', { count: ruleCount })
                : undefined,
            confirmText: t('common.delete'),
            confirmDanger: true,
            onConfirm: () => {
                deleteContext(context.id);
            },
        });
    };

    return (
        <div className="p-setting__context-item">
            <div className="p-setting__context-item-head">
                <IconPicker
                    value={context.icon}
                    color={resolveContextAccent(context)}
                    onChange={(icon) => updateContext(context.id, { icon })}
                />
                <ColorPicker
                    value={color}
                    onChange={(next) => updateContext(context.id, { color: next })}
                />
                <ContextNameInput context={context} />
                {isDefault && (
                    <Badge variant="tint" title={t('settings.context.default_context_desc')}>
                        {t('common.default')}
                    </Badge>
                )}
                <span className="p-setting__context-item-meta">
                    {t('settings.context.playlist_count', { count: selectedCount })}
                </span>
                <Button
                    variant="icon"
                    size="sq"
                    disabled={isDefault}
                    icon={<Trash2 width={16} height={16} />}
                    title={
                        isDefault
                            ? t('settings.context.cannot_delete_default')
                            : t('settings.context.delete_context')
                    }
                    aria-label={t('settings.context.delete_context')}
                    onClick={handleDelete}
                />
            </div>
            {sheets.length ? (
                <div className="p-setting__context-sheets">
                    {sheets.map((sheet) => {
                        const isFavorite = sheet.id === DEFAULT_FAVORITE_SHEET_ID;
                        const Icon = isFavorite ? Heart : ListMusic;
                        return (
                            <Chip
                                key={sheet.id}
                                label={
                                    isFavorite
                                        ? t('media.default_favorite_sheet_name')
                                        : sheet.title
                                }
                                active={selected.has(sheet.id)}
                                prefix={<Icon size={12} />}
                                onClick={() => toggleSheet(sheet.id)}
                            />
                        );
                    })}
                </div>
            ) : (
                <div className="p-setting__context-hint">{t('settings.context.no_playlists')}</div>
            )}
        </div>
    );
}

// ─── List ───

interface ContextListProps {
    config: IContextConfig;
}

/** ContextList — edit contexts: icon, name, playlists; add and delete. */
export function ContextList({ config }: ContextListProps) {
    const { t } = useTranslation();
    const sheets = useMusicSheetList();

    return (
        <div className="p-setting__context-list">
            {config.contexts.map((context) => (
                <ContextItem
                    key={context.id}
                    context={context}
                    isDefault={context.id === config.defaultContextId}
                    ruleCount={config.rules.filter((rule) => rule.contextId === context.id).length}
                    sheets={sheets}
                />
            ))}
            <div className="p-setting__action-row">
                <Button
                    variant="secondary"
                    size="sm"
                    icon={<Plus width={14} height={14} />}
                    onClick={() => addContext(t('settings.context.new_context_name'), 'sparkles')}
                >
                    {t('settings.context.add_context')}
                </Button>
            </div>
        </div>
    );
}
