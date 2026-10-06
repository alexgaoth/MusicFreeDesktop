/**
 * appConfig — 默认配置值
 *
 * 提供应用配置的默认值，作为配置加载失败或重置时的回退。
 */
import type { IAppConfig } from '@appTypes/infra/appConfig';
import {
    DEFAULT_CONTEXT_ID,
    DEFAULT_CONTEXTS,
    DEFAULT_DEBOUNCE_SEC,
    DEFAULT_MIN_DWELL_SEC,
    DEFAULT_RULES,
} from '@infra/contextEngine/common/defaults';

const defaultAppConfig: IAppConfig = {
    '$schema-version': 1,
    'playMusic.whenQualityMissing': 'lower',
    'playMusic.defaultQuality': 'standard',
    'playMusic.clickMusicList': 'replace',
    'playMusic.caseSensitiveInSearch': false,
    'playMusic.playError': 'skip',
    'playMusic.whenDeviceRemoved': 'play',
    'normal.taskbarThumb': 'window',
    'normal.closeBehavior': 'minimize',
    'normal.checkUpdate': true,
    'normal.maxHistoryLength': 30,
    'download.defaultQuality': 'standard',
    'download.whenQualityMissing': 'lower',
    'lyric.enableDesktopLyric': false,
    'lyric.alwaysOnTop': true,
    'lyric.lockLyric': false,
    'lyric.fontData': null,
    'lyric.fontColor': '#ffffff',
    'lyric.strokeColor': '#f5c542',
    'lyric.fontSize': 48,
    'shortCut.enableLocal': true,
    'shortCut.enableGlobal': false,
    'download.concurrency': 5,
    'download.interval': 0,
    'download.intervalJitter': 0,
    'normal.musicListHideColumns': ['duration'],
    'backup.resumeBehavior': 'append',
    // 'normal.language' 不设默认值：未显式选择时由 i18n 按系统语言推断（见 i18n/main.ts）
    'normal.useCustomTrayMenu': true,
    'context.enabled': false,
    'context.contexts': DEFAULT_CONTEXTS,
    'context.rules': DEFAULT_RULES,
    'context.defaultContextId': DEFAULT_CONTEXT_ID,
    'context.debounceSec': DEFAULT_DEBOUNCE_SEC,
    'context.minDwellSec': DEFAULT_MIN_DWELL_SEC,
    'context.meetingAction': 'duck',
    'context.manualOverride': null,
};

export default defaultAppConfig;
