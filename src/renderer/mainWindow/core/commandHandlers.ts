/**
 * Command Handlers — 非 TrackPlayer 的 appSync 指令处理
 *
 * 注册 toggle-desktop-lyric、toggle-minimode 等快捷键指令的 renderer 端 handler。
 * 在 bootstrap 中 trackPlayer.setup() 之后调用。
 */
import appConfig from '@infra/appConfig/renderer';
import appSync from '@infra/appSync/renderer/main';
import logger from '@infra/logger/renderer';
import contextPlayback from '@renderer/mainWindow/core/contextPlayback';
import systemUtil from '@infra/systemUtil/renderer';
import { openFullscreenPlayer } from '@renderer/mainWindow/components/layout/FullscreenPlayer/fullscreenPlayerState';
import router from '@renderer/mainWindow/router';

export function setupCommandHandlers(): void {
    appSync.onCommand('toggle-desktop-lyric', () => {
        const current = appConfig.getConfigByKey('lyric.enableDesktopLyric');
        appConfig.setConfig({ 'lyric.enableDesktopLyric': !current });
    });

    appSync.onCommand('toggle-minimode', () => {
        systemUtil.toggleMinimode();
    });

    appSync.onCommand('open-music-detail', () => {
        openFullscreenPlayer();
    });

    appSync.onCommand('navigate', (path) => {
        router.navigate('/' + path);
    });

    // 情境切换 → 情境配乐（Soundtrack 模式下切歌 / 会议闪避）
    appSync.onCommand('context-changed', (change) => {
        logger.info('[ContextEngine] context-changed', change);
        contextPlayback.handleContextChange(change).catch((e) => {
            logger.error('[ContextPlayback] context change failed', e);
        });
    });
}
