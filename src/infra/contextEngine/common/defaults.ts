/**
 * contextEngine — default contexts and rules
 *
 * Pure data (type imports only), so plain node scripts can import it.
 * Context ids are stable: rules, overrides and change events refer to them.
 */
import type { IContextDef, IContextRule } from '@appTypes/infra/contextEngine';

/** Stable ids of the built-in contexts */
export const CONTEXT_ID = {
    FOCUS: 'focus',
    WORK: 'work',
    COMMS: 'comms',
    BREAK: 'break',
    IDLE: 'idle',
} as const;

export const DEFAULT_CONTEXTS: IContextDef[] = [
    { id: CONTEXT_ID.FOCUS, name: 'Deep work', icon: 'brain', sheetIds: [] },
    { id: CONTEXT_ID.WORK, name: 'Light work', icon: 'briefcase', sheetIds: [] },
    { id: CONTEXT_ID.COMMS, name: 'Communication', icon: 'message-circle', sheetIds: [] },
    { id: CONTEXT_ID.BREAK, name: 'Break', icon: 'coffee', sheetIds: [] },
    { id: CONTEXT_ID.IDLE, name: 'Idle', icon: 'moon', sheetIds: [] },
];

/** Editors, IDEs and terminals */
const FOCUS_BUNDLE_IDS = [
    'com.apple.dt.Xcode',
    'com.microsoft.VSCode',
    'com.microsoft.VSCodeInsiders',
    'com.todesktop.230313mzl4w4u92', // Cursor
    'dev.zed.Zed',
    'com.sublimetext.4',
    'com.jetbrains.intellij',
    'com.jetbrains.intellij.ce',
    'com.jetbrains.pycharm',
    'com.jetbrains.WebStorm',
    'com.apple.Terminal',
    'com.googlecode.iterm2',
    'dev.warp.Warp-Stable',
    'com.mitchellh.ghostty',
];

/** Chat, mail and call apps */
const COMMS_BUNDLE_IDS = [
    'com.tinyspeck.slackmacgap', // Slack
    'com.apple.mail',
    'com.microsoft.Outlook',
    'com.apple.MobileSMS', // Messages
    'com.apple.FaceTime',
    'us.zoom.xos',
    'com.microsoft.teams2',
    'com.microsoft.teams',
    'com.hnc.Discord',
    'ru.keepcoder.Telegram',
    'net.whatsapp.WhatsApp',
    'com.tencent.xinWeChat',
];

/** Browsers, notes and office apps */
const WORK_BUNDLE_IDS = [
    'com.apple.Safari',
    'com.google.Chrome',
    'company.thebrowser.Browser', // Arc
    'org.mozilla.firefox',
    'notion.id',
    'md.obsidian',
    'com.apple.Notes',
    'com.apple.iWork.Pages',
    'com.apple.Pages',
    'com.apple.iWork.Numbers',
    'com.apple.iWork.Keynote',
    'com.microsoft.Word',
    'com.microsoft.Excel',
    'com.microsoft.Powerpoint',
    'com.figma.Desktop',
];

/**
 * Ordered, first match wins:
 *   1. microphone in use (meeting) → comms (urgent)
 *   2. idle ≥ 5 min → idle (before app rules: the frontmost app does not change when away)
 *   3. app rules
 * No match → `context.defaultContextId` ('work').
 */
export const DEFAULT_RULES: IContextRule[] = [
    { id: 'default-mic', contextId: CONTEXT_ID.COMMS, match: { kind: 'mic' } },
    { id: 'default-idle', contextId: CONTEXT_ID.IDLE, match: { kind: 'idle', minSec: 300 } },
    {
        id: 'default-focus-apps',
        contextId: CONTEXT_ID.FOCUS,
        match: { kind: 'app', bundleIds: FOCUS_BUNDLE_IDS },
    },
    {
        id: 'default-comms-apps',
        contextId: CONTEXT_ID.COMMS,
        match: { kind: 'app', bundleIds: COMMS_BUNDLE_IDS },
    },
    {
        id: 'default-work-apps',
        contextId: CONTEXT_ID.WORK,
        match: { kind: 'app', bundleIds: WORK_BUNDLE_IDS },
    },
];

export const DEFAULT_CONTEXT_ID = CONTEXT_ID.WORK;
export const DEFAULT_DEBOUNCE_SEC = 45;
export const DEFAULT_MIN_DWELL_SEC = 300;
