import { useMemo, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ChevronDown, ChevronUp, GripVertical, Plus, Trash2, X } from 'lucide-react';
import { cn } from '@common/cn';
import { Button } from '@renderer/mainWindow/components/ui/Button';
import { Chip } from '@renderer/mainWindow/components/ui/Chip';
import { Input } from '@renderer/mainWindow/components/ui/Input';
import { Select } from '@renderer/mainWindow/components/ui/Select';
import { Toggle } from '@renderer/mainWindow/components/ui/Toggle';
import { useCurrentContext } from '@infra/contextEngine/renderer';
import {
    createId,
    defaultMatch,
    moveRule,
    saveRules,
    updateRule,
    type IContextConfig,
} from '@renderer/mainWindow/common/contextConfig';
import type {
    ContextRuleKind,
    IContextAppInfo,
    IContextRule,
    IContextRuleMatch,
} from '@appTypes/infra/contextEngine';
import { NumberField } from './NumberField';

const RULE_KINDS: ContextRuleKind[] = ['app', 'idle', 'mic', 'time'];

/** Weekdays in display order (Monday first); values follow Date#getDay (0 = Sunday) */
const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 0];

/** Names of the apps in the default rules, shown until the app has been seen */
const KNOWN_APP_NAMES: Record<string, string> = {
    'com.apple.dt.xcode': 'Xcode',
    'com.microsoft.vscode': 'Visual Studio Code',
    'com.microsoft.vscodeinsiders': 'VS Code Insiders',
    'com.todesktop.230313mzl4w4u92': 'Cursor',
    'dev.zed.zed': 'Zed',
    'com.sublimetext.4': 'Sublime Text',
    'com.jetbrains.intellij': 'IntelliJ IDEA',
    'com.jetbrains.intellij.ce': 'IntelliJ IDEA CE',
    'com.jetbrains.pycharm': 'PyCharm',
    'com.jetbrains.webstorm': 'WebStorm',
    'com.apple.terminal': 'Terminal',
    'com.googlecode.iterm2': 'iTerm',
    'dev.warp.warp-stable': 'Warp',
    'com.mitchellh.ghostty': 'Ghostty',
    'com.tinyspeck.slackmacgap': 'Slack',
    'com.apple.mail': 'Mail',
    'com.microsoft.outlook': 'Outlook',
    'com.apple.mobilesms': 'Messages',
    'com.apple.facetime': 'FaceTime',
    'us.zoom.xos': 'Zoom',
    'com.microsoft.teams2': 'Microsoft Teams',
    'com.microsoft.teams': 'Microsoft Teams (classic)',
    'com.hnc.discord': 'Discord',
    'ru.keepcoder.telegram': 'Telegram',
    'net.whatsapp.whatsapp': 'WhatsApp',
    'com.tencent.xinwechat': 'WeChat',
    'com.apple.safari': 'Safari',
    'com.google.chrome': 'Google Chrome',
    'company.thebrowser.browser': 'Arc',
    'org.mozilla.firefox': 'Firefox',
    'notion.id': 'Notion',
    'md.obsidian': 'Obsidian',
    'com.apple.notes': 'Notes',
    'com.apple.iwork.pages': 'Pages',
    'com.apple.pages': 'Pages',
    'com.apple.iwork.numbers': 'Numbers',
    'com.apple.iwork.keynote': 'Keynote',
    'com.microsoft.word': 'Word',
    'com.microsoft.excel': 'Excel',
    'com.microsoft.powerpoint': 'PowerPoint',
    'com.figma.desktop': 'Figma',
};

const BUNDLE_ID_PATTERN = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

function appName(bundleId: string, recentApps: IContextAppInfo[]): string {
    const lower = bundleId.toLowerCase();
    const seen = recentApps.find((app) => app.bundleId.toLowerCase() === lower);
    return seen?.name || KNOWN_APP_NAMES[lower] || bundleId;
}

// ─── Kind editors ───

type MatchOf<K extends ContextRuleKind> = Extract<IContextRuleMatch, { kind: K }>;

interface MatchEditorProps<K extends ContextRuleKind> {
    match: MatchOf<K>;
    /** Apply a change to the latest saved match (safe for fast repeated edits) */
    update: (fn: (match: MatchOf<K>) => MatchOf<K>) => void;
}

function AppMatchEditor({ match, update }: MatchEditorProps<'app'>) {
    const { t } = useTranslation();
    const recentApps = useCurrentContext()?.recentApps ?? [];
    const [draft, setDraft] = useState('');
    const [draftError, setDraftError] = useState(false);

    const included = new Set(match.bundleIds.map((id) => id.toLowerCase()));
    const recentOptions = recentApps
        .filter((app) => !included.has(app.bundleId.toLowerCase()))
        .map((app) => ({ value: app.bundleId, label: app.name || app.bundleId }));

    const add = (bundleId: string) => {
        const id = bundleId.trim();
        if (!id || included.has(id.toLowerCase())) return;
        update((latest) =>
            latest.bundleIds.some((item) => item.toLowerCase() === id.toLowerCase())
                ? latest
                : { ...latest, bundleIds: [...latest.bundleIds, id] },
        );
    };

    const addDraft = () => {
        const id = draft.trim();
        if (!BUNDLE_ID_PATTERN.test(id)) {
            setDraftError(true);
            return;
        }
        add(id);
        setDraft('');
    };

    return (
        <div className="p-setting__context-rule-editor">
            {match.bundleIds.length ? (
                <div className="p-setting__context-apps">
                    {match.bundleIds.map((bundleId) => {
                        const name = appName(bundleId, recentApps);
                        return (
                            <Chip
                                key={bundleId}
                                label={name}
                                title={bundleId}
                                aria-label={t('settings.context.remove_app', { name })}
                                suffix={<X />}
                                onClick={() =>
                                    update((latest) => ({
                                        ...latest,
                                        bundleIds: latest.bundleIds.filter((id) => id !== bundleId),
                                    }))
                                }
                            />
                        );
                    })}
                </div>
            ) : (
                <div className="p-setting__context-hint">{t('settings.context.app_empty')}</div>
            )}
            <div className="p-setting__context-inline">
                <Select
                    className="p-setting__context-app-select"
                    value=""
                    placeholder={
                        recentOptions.length
                            ? t('settings.context.app_add_recent')
                            : t('settings.context.app_no_recent')
                    }
                    disabled={!recentOptions.length}
                    options={recentOptions}
                    onChange={add}
                />
                <Input
                    className="p-setting__context-bundle-input"
                    value={draft}
                    hasError={draftError}
                    placeholder={t('settings.context.app_bundle_placeholder')}
                    aria-label={t('settings.context.app_bundle_placeholder')}
                    onChange={(e) => {
                        setDraft(e.target.value);
                        setDraftError(false);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') addDraft();
                    }}
                />
                <Button variant="secondary" size="sm" disabled={!draft.trim()} onClick={addDraft}>
                    {t('common.add')}
                </Button>
            </div>
        </div>
    );
}

function IdleMatchEditor({ match, update }: MatchEditorProps<'idle'>) {
    const { t } = useTranslation();
    return (
        <div className="p-setting__context-inline">
            <span className="p-setting__context-inline-label">
                {t('settings.context.idle_label')}
            </span>
            <NumberField
                value={Math.max(1, Math.round(match.minSec / 60))}
                min={1}
                max={240}
                unit={t('settings.context.minutes_unit')}
                aria-label={t('settings.context.idle_label')}
                onCommit={(minutes) => update((latest) => ({ ...latest, minSec: minutes * 60 }))}
            />
        </div>
    );
}

function MicMatchEditor() {
    const { t } = useTranslation();
    return <div className="p-setting__context-hint">{t('settings.context.mic_hint')}</div>;
}

function TimeMatchEditor({ match, update }: MatchEditorProps<'time'>) {
    const { t, i18n } = useTranslation();
    const dayNames = useMemo(() => {
        const format = new Intl.DateTimeFormat(i18n.language, { weekday: 'short' });
        // 2024-01-07 is a Sunday: day d of that week is 7 + d.
        return WEEK_DAYS.map((day) => ({ day, label: format.format(new Date(2024, 0, 7 + day)) }));
    }, [i18n.language]);
    const days = new Set(match.days ?? []);

    const toggleDay = (day: number) => {
        update((latest) => {
            const next = new Set(latest.days ?? []);
            if (next.has(day)) {
                next.delete(day);
            } else {
                next.add(day);
            }
            const sorted = [...next].sort((a, b) => a - b);
            // None or all seven days both mean "every day".
            return { ...latest, days: sorted.length && sorted.length < 7 ? sorted : undefined };
        });
    };

    return (
        <div className="p-setting__context-rule-editor">
            <div className="p-setting__context-inline">
                <span className="p-setting__context-inline-label">
                    {t('settings.context.time_from')}
                </span>
                <Input
                    className="p-setting__context-time"
                    type="time"
                    value={match.from}
                    aria-label={t('settings.context.time_from')}
                    onChange={(e) => {
                        const from = e.target.value;
                        if (from) update((latest) => ({ ...latest, from }));
                    }}
                />
                <span className="p-setting__context-inline-label">
                    {t('settings.context.time_to')}
                </span>
                <Input
                    className="p-setting__context-time"
                    type="time"
                    value={match.to}
                    aria-label={t('settings.context.time_to')}
                    onChange={(e) => {
                        const to = e.target.value;
                        if (to) update((latest) => ({ ...latest, to }));
                    }}
                />
            </div>
            <div className="p-setting__context-inline">
                {dayNames.map(({ day, label }) => (
                    <Chip
                        key={day}
                        label={label}
                        active={days.has(day)}
                        className="p-setting__context-day"
                        onClick={() => toggleDay(day)}
                    />
                ))}
                <span className="p-setting__context-hint">
                    {days.size
                        ? t('settings.context.time_days_some')
                        : t('settings.context.time_days_all')}
                </span>
            </div>
        </div>
    );
}

function MatchEditor({ ruleId, match }: { ruleId: string; match: IContextRuleMatch }) {
    const updater =
        <K extends ContextRuleKind>(kind: K) =>
        (fn: (latest: MatchOf<K>) => MatchOf<K>) =>
            updateRule(ruleId, (rule) =>
                rule.match.kind === kind ? { match: fn(rule.match as MatchOf<K>) } : {},
            );

    switch (match.kind) {
        case 'app':
            return <AppMatchEditor match={match} update={updater('app')} />;
        case 'idle':
            return <IdleMatchEditor match={match} update={updater('idle')} />;
        case 'mic':
            return <MicMatchEditor />;
        case 'time':
            return <TimeMatchEditor match={match} update={updater('time')} />;
    }
}

// ─── Rule list ───

interface RuleListProps {
    config: IContextConfig;
}

/** RuleList — ordered rules (first match wins): reorder, enable, edit, add, delete. */
export function RuleList({ config }: RuleListProps) {
    const { t } = useTranslation();
    const { rules, contexts } = config;

    const [armedId, setArmedId] = useState<string | null>(null);
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [overIndex, setOverIndex] = useState<number | null>(null);

    const kindOptions = RULE_KINDS.map((kind) => ({
        value: kind,
        label: t(`settings.context.kind_${kind}`),
    }));
    const contextOptions = contexts.map((ctx) => ({ value: ctx.id, label: ctx.name }));

    const resetDrag = () => {
        setArmedId(null);
        setDragIndex(null);
        setOverIndex(null);
    };

    const handleDrop = (e: DragEvent, index: number) => {
        e.preventDefault();
        if (dragIndex !== null) moveRule(dragIndex, index);
        resetDrag();
    };

    const addRule = () => {
        const rule: IContextRule = {
            id: createId('rule'),
            contextId: config.defaultContextId,
            enabled: true,
            match: defaultMatch('app'),
        };
        saveRules([...rules, rule]);
    };

    return (
        <div className="p-setting__context-list">
            {rules.length ? null : (
                <div className="p-setting__context-empty">{t('settings.context.no_rules')}</div>
            )}
            {rules.map((rule, index) => {
                const enabled = rule.enabled !== false;
                return (
                    <div
                        key={rule.id}
                        className={cn(
                            'p-setting__context-rule',
                            !enabled && 'is-disabled',
                            dragIndex === index && 'is-dragging',
                            overIndex === index && dragIndex !== index && 'is-drop-target',
                        )}
                        draggable={armedId === rule.id}
                        onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', rule.id);
                            setDragIndex(index);
                        }}
                        onDragOver={(e) => {
                            if (dragIndex === null) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                            if (overIndex !== index) setOverIndex(index);
                        }}
                        onDrop={(e) => handleDrop(e, index)}
                        onDragEnd={resetDrag}
                    >
                        <div className="p-setting__context-rule-head">
                            <span
                                className="p-setting__context-rule-grip"
                                title={t('settings.context.drag_to_reorder')}
                                onMouseDown={() => setArmedId(rule.id)}
                                onMouseUp={() => setArmedId(null)}
                            >
                                <GripVertical size={16} />
                            </span>
                            <span className="p-setting__context-rule-index">{index + 1}</span>
                            <Select
                                className="p-setting__context-rule-kind"
                                value={rule.match.kind}
                                options={kindOptions}
                                onChange={(kind) => {
                                    if (kind === rule.match.kind) return;
                                    updateRule(rule.id, {
                                        match: defaultMatch(kind as ContextRuleKind),
                                    });
                                }}
                            />
                            <ArrowRight size={14} className="p-setting__context-rule-arrow" />
                            <Select
                                className="p-setting__context-rule-target"
                                value={rule.contextId}
                                options={contextOptions}
                                onChange={(contextId) => updateRule(rule.id, { contextId })}
                            />
                            <span className="p-setting__context-rule-spacer" />
                            <Toggle
                                checked={enabled}
                                title={t('settings.context.rule_enabled')}
                                aria-label={t('settings.context.rule_enabled')}
                                onChange={(checked) => updateRule(rule.id, { enabled: checked })}
                            />
                            <Button
                                variant="icon"
                                size="sq"
                                disabled={index === 0}
                                icon={<ChevronUp width={16} height={16} />}
                                title={t('settings.context.move_up')}
                                aria-label={t('settings.context.move_up')}
                                onClick={() => moveRule(index, index - 1)}
                            />
                            <Button
                                variant="icon"
                                size="sq"
                                disabled={index === rules.length - 1}
                                icon={<ChevronDown width={16} height={16} />}
                                title={t('settings.context.move_down')}
                                aria-label={t('settings.context.move_down')}
                                onClick={() => moveRule(index, index + 1)}
                            />
                            <Button
                                variant="icon"
                                size="sq"
                                icon={<Trash2 width={16} height={16} />}
                                title={t('settings.context.delete_rule')}
                                aria-label={t('settings.context.delete_rule')}
                                onClick={() => saveRules(rules.filter((r) => r.id !== rule.id))}
                            />
                        </div>
                        <div className="p-setting__context-rule-body">
                            <MatchEditor ruleId={rule.id} match={rule.match} />
                        </div>
                    </div>
                );
            })}
            <div className="p-setting__action-row">
                <Button
                    variant="secondary"
                    size="sm"
                    icon={<Plus width={14} height={14} />}
                    onClick={addRule}
                >
                    {t('settings.context.add_rule')}
                </Button>
            </div>
        </div>
    );
}
