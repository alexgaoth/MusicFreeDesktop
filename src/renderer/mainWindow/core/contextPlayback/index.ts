/**
 * contextPlayback — Soundtrack mode (RepeatMode.Context)
 *
 * The music follows the context engine (src/infra/contextEngine):
 *   - Next track (track end / skip next / play error): picked from the current context's
 *     sheets by ./selector.ts, inserted after the current track and played.
 *     Empty pool → the default context's sheets → the normal queue (warn once).
 *   - 'context-changed', urgent (meeting): duck to 20 % or fade out + pause
 *     (`context.meetingAction`). When the meeting ends: restore.
 *   - 'context-changed', other context: less than 60 s left → let the track finish;
 *     else fade out 4 s, play a track from the new context, fade in 2 s.
 *   - A track the user starts by hand in Soundtrack mode is respected (no switch on a context
 *     change); picking resumes when it ends.
 *
 * Fades use the player's gain (TrackPlayer.rampGain), never the user's volume setting.
 * Only active when the mode is Context and `context.enabled` is true.
 */
import type { IMusicItemSlim } from '@appTypes/infra/musicSheet';
import type { IContextChange } from '@appTypes/infra/contextEngine';
import { PlayerState, RepeatMode } from '@common/constant';
import appConfig from '@infra/appConfig/renderer';
import contextEngine from '@infra/contextEngine/renderer';
import i18n from '@infra/i18n/renderer';
import logger from '@infra/logger/renderer';
import musicSheet from '@infra/musicSheet/renderer';
import { asyncKV } from '@renderer/common/kvStore';
import { showToast } from '@renderer/mainWindow/components/ui/Toast';
import trackPlayer from '../trackPlayer';
import {
    store,
    currentMusicAtom,
    playerStateAtom,
    progressAtom,
    repeatModeAtom,
} from '../trackPlayer/store';
import { selectNextTrack, toPlayedEntry, trackKeyOf, type IPlayedEntry } from './selector';

// ─── Tuning ───

/** Gain while ducked for a meeting (relative to the user volume) */
const DUCK_GAIN = 0.2;
/** Duck / unduck / meeting fade-out time */
const MEETING_RAMP_MS = 1000;
/** Fade-out before a context switch */
const SWITCH_FADE_OUT_MS = 4000;
/** Fade-in of the new context's first track */
const SWITCH_FADE_IN_MS = 2000;
/** Less than this left → let the track finish instead of fading */
const LET_FINISH_SEC = 60;
/** Max wait for the new track to start before the fade-in starts anyway */
const PLAY_START_TIMEOUT_MS = 8000;
/** Play history kept for anti-repeat (selector uses ≤ 20 + 3) */
const HISTORY_SIZE = 50;
/** Favorite tracks are a little more likely */
const FAVORITE_WEIGHT = 1.5;

const LOG = '[ContextPlayback]';

type MeetingEffect = 'none' | 'duck' | 'pause';

class ContextPlayback {
    private isSetup = false;

    /** Last committed context (from the engine) */
    private currentContextId: string | null = null;
    /** Context the playing music belongs to (last pick); a change to another id switches music */
    private playingContextId: string | null = null;
    /** Meeting effect we applied and must undo */
    private meeting: MeetingEffect = 'none';

    /** Played tracks, most recent first */
    private history: IPlayedEntry[] = [];
    private lastMusicKey: string | null = null;
    /** Key the provider just returned: the next track change is ours, not the user's */
    private expectedKey: string | null = null;
    /** The provider fell back to the queue: the next track change is not the user's */
    private expectQueueFallback = false;
    /** Current track was started by the user in Soundtrack mode → do not switch it away */
    private manualKey: string | null = null;

    /** Bumped to cancel an in-flight switch / meeting fade */
    private token = 0;
    /** Warnings already shown (per fallback kind + context) */
    private warned = new Set<string>();

    public setup(): void {
        if (this.isSetup) return;
        this.isSetup = true;

        trackPlayer.setNextTrackProvider(() => this.pickNext());

        // The engine commits its first context before the window loads: read the state once.
        contextEngine
            .getState()
            .then((state) => {
                this.currentContextId ??= state.currentContextId;
                this.playingContextId ??= state.currentContextId;
            })
            .catch(() => {});

        this.lastMusicKey = this.keyOfCurrent();
        store.sub(currentMusicAtom, () => this.onMusicChanged());
        store.sub(repeatModeAtom, () => this.onModeChanged());
        store.sub(playerStateAtom, () => this.onPlayerStateChanged());

        appConfig.onConfigUpdated((patch) => {
            if ('context.contexts' in patch || 'context.defaultContextId' in patch) {
                this.warned.clear();
            }
        });

        // Seed the anti-repeat history with the persisted recently-played list
        asyncKV
            .get('recentlyPlayed')
            .then((list) => {
                if (!list?.length) return;
                const seeded = list.slice(0, HISTORY_SIZE).map(toPlayedEntry);
                this.history = [...this.history, ...seeded].slice(0, HISTORY_SIZE);
            })
            .catch(() => {});
    }

    // ─── Context changes ───

    public async handleContextChange(change: IContextChange): Promise<void> {
        this.currentContextId = change.contextId;
        if (!this.isActive()) return;

        if (change.urgent) {
            await this.applyMeeting();
            return;
        }

        const pausedByMeeting = this.meeting === 'pause';
        const playing = this.isPlaying() || pausedByMeeting;
        const currentKey = this.keyOfCurrent();
        const isManual = currentKey !== null && currentKey === this.manualKey;

        if (!playing || isManual || change.contextId === this.playingContextId) {
            // Nothing to switch: the next pick uses the new context anyway
            if (playing && isManual && change.contextId !== this.playingContextId) {
                logger.info(LOG, 'keep the track the user started', { to: change.contextId });
            }
            this.releaseMeeting();
            return;
        }

        const { currentTime, duration } = store.get(progressAtom);
        const remaining = isFinite(duration) ? duration - currentTime : Infinity;
        if (remaining < LET_FINISH_SEC && !pausedByMeeting) {
            logger.info(LOG, 'let the track finish', {
                to: change.contextId,
                remainingSec: Math.round(remaining),
            });
            this.releaseMeeting();
            return;
        }

        await this.switchContext(change.contextId, pausedByMeeting);
    }

    /** Fade out, play a track from the new context, fade in */
    private async switchContext(contextId: string, pausedByMeeting: boolean): Promise<void> {
        const token = ++this.token;
        const startKey = this.keyOfCurrent();
        this.meeting = 'none';
        logger.info(LOG, 'switch', { from: this.playingContextId, to: contextId });

        if (pausedByMeeting) {
            trackPlayer.setGain(0);
        } else {
            await trackPlayer.rampGain(0, SWITCH_FADE_OUT_MS);
        }
        if (token !== this.token) return;

        // During the fade: the user changed the track, paused, or left Soundtrack mode
        const userPaused = !pausedByMeeting && !this.isPlaying();
        if (!this.isActive() || this.keyOfCurrent() !== startKey || userPaused) {
            logger.info(LOG, 'switch cancelled by the user');
            void trackPlayer.rampGain(1, 300);
            return;
        }

        await trackPlayer.skipToNext(); // Soundtrack mode → picks from the current context
        if (token !== this.token) return;
        await this.waitForPlaying(PLAY_START_TIMEOUT_MS);
        if (token !== this.token) return;
        await trackPlayer.rampGain(1, SWITCH_FADE_IN_MS);
    }

    // ─── Meetings (urgent) ───

    private async applyMeeting(): Promise<void> {
        const action = appConfig.getConfigByKey('context.meetingAction') ?? 'duck';
        const token = ++this.token; // cancels a running switch
        if (action === 'none' || this.meeting !== 'none') return;
        if (!this.isPlaying()) {
            // The user paused: nothing to duck. Undo a switch fade that was cancelled.
            if (trackPlayer.getGain() < 1) trackPlayer.setGain(1);
            return;
        }

        if (action === 'duck') {
            this.meeting = 'duck';
            logger.info(LOG, 'meeting: duck');
            await trackPlayer.rampGain(DUCK_GAIN, MEETING_RAMP_MS);
            return;
        }

        this.meeting = 'pause';
        logger.info(LOG, 'meeting: fade out and pause');
        await trackPlayer.rampGain(0, MEETING_RAMP_MS);
        if (token !== this.token || this.meeting !== 'pause') return;
        trackPlayer.pause();
        trackPlayer.setGain(1);
    }

    /** Undo the meeting effect (unduck / resume) */
    private releaseMeeting(): void {
        const effect = this.meeting;
        if (effect === 'none') return;
        this.meeting = 'none';
        this.token++;
        logger.info(LOG, 'meeting over: restore', { effect });

        if (effect === 'pause') {
            trackPlayer.setGain(0);
            trackPlayer.resume();
        }
        void trackPlayer.rampGain(1, MEETING_RAMP_MS);
    }

    // ─── Next track ───

    private async pickNext(): Promise<IMusicItemSlim | null> {
        const defaultId = appConfig.getConfigByKey('context.defaultContextId') ?? null;
        const contextId = this.currentContextId ?? defaultId;
        if (!contextId) return this.fallBackToQueue('none');

        let pool = await this.loadPool(contextId);
        let source = contextId;
        if (pool.length === 0 && defaultId && defaultId !== contextId) {
            pool = await this.loadPool(defaultId);
            source = defaultId;
            if (pool.length > 0) {
                this.warnOnce(
                    `default:${contextId}`,
                    i18n.t('playback.context_fallback_default', {
                        name: this.contextName(contextId),
                    }),
                );
            }
        }
        if (pool.length === 0) return this.fallBackToQueue(contextId);

        const result = selectNextTrack(pool, {
            recent: this.history,
            currentKey: this.keyOfCurrent(),
            weightOf: (track) => (musicSheet.isFavoriteMusic(track) ? FAVORITE_WEIGHT : 1),
        });
        const track = result.track;
        if (!track) return this.fallBackToQueue(contextId);

        logger.info(LOG, 'pick', {
            context: contextId,
            from: source,
            title: track.title,
            artist: track.artist,
            pool: result.poolSize,
            candidates: result.candidates,
            excludedRecent: result.excludedRecent,
            artistCooldown: result.artistCooldownApplied,
        });
        this.expectedKey = trackKeyOf(track);
        this.expectQueueFallback = false;
        this.playingContextId = contextId;
        return track;
    }

    private fallBackToQueue(contextId: string): null {
        this.warnOnce(`queue:${contextId}`, i18n.t('playback.context_fallback_queue'));
        this.expectedKey = null;
        this.expectQueueFallback = true;
        this.playingContextId = contextId === 'none' ? null : contextId;
        return null;
    }

    /** Union of the context's sheets (duplicates are removed by the selector) */
    private async loadPool(contextId: string): Promise<IMusicItemSlim[]> {
        const contexts = appConfig.getConfigByKey('context.contexts') ?? [];
        const sheetIds = contexts.find((ctx) => ctx.id === contextId)?.sheetIds ?? [];
        if (sheetIds.length === 0) return [];
        const lists = await Promise.all(
            sheetIds.map((id) =>
                musicSheet.getSheetMusicList(id).catch((e) => {
                    logger.warn(LOG, 'cannot read sheet', id, e);
                    return [] as IMusicItemSlim[];
                }),
            ),
        );
        return lists.flat();
    }

    // ─── Store listeners ───

    private onMusicChanged(): void {
        const music = store.get(currentMusicAtom);
        const key = music ? trackKeyOf(music) : null;
        if (key === this.lastMusicKey) return; // metadata update of the same track
        this.lastMusicKey = key;
        if (!music || !key) return;

        this.history = [toPlayedEntry(music), ...this.history].slice(0, HISTORY_SIZE);

        if (store.get(repeatModeAtom) === RepeatMode.Context) {
            const ours = key === this.expectedKey || this.expectQueueFallback;
            this.manualKey = ours ? null : key;
        }
        this.expectedKey = null;
        this.expectQueueFallback = false;
    }

    private onModeChanged(): void {
        if (store.get(repeatModeAtom) === RepeatMode.Context) {
            // The playing track counts as the current context's; switch on the next change
            this.manualKey = null;
            this.playingContextId = this.currentContextId;
            return;
        }
        // Left Soundtrack mode: cancel fades, undo the meeting effect, full gain
        this.token++;
        this.meeting = 'none';
        if (trackPlayer.getGain() < 1) void trackPlayer.rampGain(1, 300);
    }

    private onPlayerStateChanged(): void {
        // The user pressed play during a meeting pause: the pause is no longer ours to undo
        if (this.meeting === 'pause' && store.get(playerStateAtom) === PlayerState.Playing) {
            this.meeting = 'none';
            this.token++;
            if (trackPlayer.getGain() < 1) trackPlayer.setGain(1);
        }
    }

    // ─── Helpers ───

    private isActive(): boolean {
        return (
            store.get(repeatModeAtom) === RepeatMode.Context &&
            !!appConfig.getConfigByKey('context.enabled')
        );
    }

    private isPlaying(): boolean {
        const state = store.get(playerStateAtom);
        return state === PlayerState.Playing || state === PlayerState.Buffering;
    }

    private keyOfCurrent(): string | null {
        const music = store.get(currentMusicAtom);
        return music ? trackKeyOf(music) : null;
    }

    private contextName(contextId: string): string {
        const contexts = appConfig.getConfigByKey('context.contexts') ?? [];
        return contexts.find((ctx) => ctx.id === contextId)?.name ?? contextId;
    }

    private warnOnce(key: string, message: string): void {
        if (this.warned.has(key)) return;
        this.warned.add(key);
        logger.warn(LOG, message);
        showToast(message, { type: 'warn' });
    }

    private waitForPlaying(timeoutMs: number): Promise<void> {
        if (store.get(playerStateAtom) === PlayerState.Playing) return Promise.resolve();
        return new Promise((resolve) => {
            const done = () => {
                clearTimeout(timer);
                unsub();
                resolve();
            };
            const timer = setTimeout(done, timeoutMs);
            const unsub = store.sub(playerStateAtom, () => {
                if (store.get(playerStateAtom) === PlayerState.Playing) done();
            });
        });
    }
}

const contextPlayback = new ContextPlayback();
export default contextPlayback;
