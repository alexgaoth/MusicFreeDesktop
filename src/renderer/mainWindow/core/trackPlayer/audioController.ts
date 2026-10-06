/**
 * AudioController — IAudioController 接口 + WebAudioController 实现
 *
 * 底层音频播放抽象，面向接口编程。
 * 当前实现：WebAudioController（HTMLAudioElement + HLS）
 * 未来扩展：MpvAudioController 等
 */
import EventEmitter from 'eventemitter3';
import Hls from 'hls.js';
import type { IMusicItemSlim } from '@appTypes/infra/musicSheet';
import { PlayerState, ErrorReason } from '@common/constant';
import requestForwarder from '@infra/requestForwarder/renderer';

// ─── 事件类型 ───

export interface IAudioControllerEvents {
    /** 播放状态变化 */
    stateChange: (state: PlayerState) => void;
    /** 播放进度更新 */
    timeUpdate: (progress: { currentTime: number; duration: number }) => void;
    /** 播放结束（携带结束瞬间的位置，供上层区分自然播完与流被截断） */
    ended: (info: { currentTime: number; duration: number }) => void;
    /** 播放错误 */
    error: (reason: ErrorReason, detail?: any) => void;
    /** 音量变化 */
    volumeChange: (volume: number) => void;
    /** 速度变化 */
    speedChange: (speed: number) => void;
}

// ─── 接口定义 ───

/** 音频控制器接口 — 所有实现必须遵守 */
export interface IAudioController extends EventEmitter<IAudioControllerEvents> {
    /** 预准备（设置 MediaSession metadata，清空旧音源） */
    prepareTrack(musicItem: IMusicItemSlim): void;
    /** 设置音源并可选自动播放 */
    setTrackSource(source: IPlugin.IMediaSourceResult, musicItem: IMusic.IMusicItem): void;
    play(): void;
    pause(): void;
    seekTo(seconds: number): void;
    reset(): void;
    destroy(): void;

    /** 用户音量（持久化、显示在音量条上）。会取消进行中的增益渐变并停在其目标值 */
    setVolume(volume: number): void;
    /**
     * 增益：叠加在用户音量上的系数（0…1），实际输出 = 用户音量 × 增益。
     * 用于淡入淡出 / 闪避（duck），不改变用户音量设置，也不触发 volumeChange。
     */
    readonly gain: number;
    /** 立即设置增益（取消进行中的渐变） */
    setGain(gain: number): void;
    /**
     * 在 ms 毫秒内把增益线性渐变到 target。新的渐变会取消旧的（从当前值继续）。
     * @returns 完成时 resolve(true)；被取消（新渐变 / setGain / setVolume）时 resolve(false)
     */
    rampGain(target: number, ms: number): Promise<boolean>;
    setSpeed(speed: number): void;
    setSinkId(deviceId: string): Promise<void>;

    readonly playerState: PlayerState;
    readonly hasSource: boolean;
}

// ─── WebAudioController 实现 ───

/** 增益渐变的步进间隔（ms）。按经过的时间插值，计时器被节流时也能准时结束 */
const RAMP_STEP_MS = 30;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

interface IGainRamp {
    target: number;
    timer: ReturnType<typeof setInterval>;
    resolve: (completed: boolean) => void;
}

class WebAudioController extends EventEmitter<IAudioControllerEvents> implements IAudioController {
    private audio: HTMLAudioElement;
    private hls: Hls | null = null;
    private _playerState: PlayerState = PlayerState.None;
    private _sourceId = 0; // fetch 竞态守卫
    private _currentBlobUrl: string | null = null; // 追踪 blob URL 防止内存泄漏
    private _userVolume = 1; // 用户音量（持久化值）
    private _gain = 1; // 渐变 / 闪避增益，不持久化
    private _ramp: IGainRamp | null = null;

    get playerState(): PlayerState {
        return this._playerState;
    }

    get gain(): number {
        return this._gain;
    }

    get hasSource(): boolean {
        return !!this.audio.src && this.audio.src !== location.href;
    }

    constructor() {
        super();
        this.audio = new Audio();
        this.audio.preload = 'auto';
        this.audio.controls = false;
        this.bindEvents();
    }

    prepareTrack(musicItem: IMusicItemSlim): void {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: musicItem.title,
            artist: musicItem.artist,
            album: musicItem.album ?? undefined,
            artwork: musicItem.artwork ? [{ src: musicItem.artwork }] : undefined,
        });
        this.setPlayerState(PlayerState.None);
        this.audio.src = '';
        this.audio.removeAttribute('src');
        navigator.mediaSession.playbackState = 'none';
    }

    setTrackSource(source: IPlugin.IMediaSourceResult, _musicItem: IMusic.IMusicItem): void {
        this.destroyHls();
        this.revokeBlobUrl();
        this.setPlayerState(PlayerState.None);
        const sourceId = ++this._sourceId;

        // 从 URL 的 userinfo 部分提取 Basic Auth（如 http://user:pass@host/...）
        const { cleanUrl: url, authHeader } = this.extractBasicAuth(source.url!);
        let headers = this.buildHeaders(source);
        if (authHeader) {
            if (!headers) headers = {};
            headers['Authorization'] = authHeader;
        }

        // HLS 支持
        if (this.isHls(source.url!)) {
            if (Hls.isSupported()) {
                this.initHls();
                if (headers) {
                    // HLS 自定义 header 通过 xhrSetup
                    this.hls!.config.xhrSetup = (xhr: XMLHttpRequest) => {
                        for (const [key, value] of Object.entries(headers)) {
                            xhr.setRequestHeader(key, value);
                        }
                    };
                }
                this.hls!.loadSource(url);
            } else {
                this.emit('error', ErrorReason.UnsupportedResource);
            }
            return;
        }

        // 带 header 的非 HLS：通过代理服务器
        if (headers) {
            const proxyUrl = requestForwarder.buildProxyUrl(url, headers);
            if (proxyUrl !== url) {
                // 代理可用，直接设置代理 URL
                this.audio.src = proxyUrl;
                return;
            }
            // 代理不可用，降级到 fetch
            fetch(url, { method: 'GET', headers })
                .then((res) => res.blob())
                .then((blob) => {
                    // 竞态守卫：fetch 期间可能已切歌
                    if (this._sourceId !== sourceId) return;
                    this._currentBlobUrl = URL.createObjectURL(blob);
                    this.audio.src = this._currentBlobUrl;
                })
                .catch((err) => {
                    if (this._sourceId !== sourceId) return;
                    this.emit('error', ErrorReason.EmptyResource, err);
                });
            return;
        }

        this.audio.src = url;
    }

    play(): void {
        if (this.hasSource) {
            this.audio.play().catch(() => {});
        }
    }

    pause(): void {
        if (this.hasSource) {
            this.audio.pause();
        }
    }

    seekTo(seconds: number): void {
        if (this.hasSource && isFinite(seconds)) {
            this.audio.currentTime = Math.min(seconds, this.audio.duration || Infinity);
        }
    }

    setVolume(volume: number): void {
        // 用户调节音量：停止渐变并直接落在目标增益（如闪避中仍保持闪避）
        this.cancelRamp(true);
        const next = clamp01(volume);
        const changed = next !== this._userVolume;
        this._userVolume = next;
        this.applyVolume();
        // 由此处（而非 audio 的 volumechange）上报，避免增益渐变把衰减后的值写进用户设置
        if (changed) this.emit('volumeChange', next);
    }

    setGain(gain: number): void {
        this.cancelRamp(false);
        this._gain = clamp01(gain);
        this.applyVolume();
    }

    rampGain(target: number, ms: number): Promise<boolean> {
        this.cancelRamp(false);
        const to = clamp01(target);
        const from = this._gain;
        if (ms <= 0 || from === to) {
            this._gain = to;
            this.applyVolume();
            return Promise.resolve(true);
        }

        const start = performance.now();
        return new Promise<boolean>((resolve) => {
            const ramp: IGainRamp = {
                target: to,
                resolve,
                timer: setInterval(() => {
                    const t = Math.min(1, (performance.now() - start) / ms);
                    this._gain = from + (to - from) * t;
                    this.applyVolume();
                    if (t >= 1 && this._ramp === ramp) {
                        clearInterval(ramp.timer);
                        this._ramp = null;
                        this._gain = to;
                        resolve(true);
                    }
                }, RAMP_STEP_MS),
            };
            this._ramp = ramp;
        });
    }

    setSpeed(speed: number): void {
        this.audio.defaultPlaybackRate = speed;
        this.audio.playbackRate = speed;
    }

    setSinkId(deviceId: string): Promise<void> {
        return (this.audio as any).setSinkId(deviceId);
    }

    reset(): void {
        this.setPlayerState(PlayerState.None);
        this.revokeBlobUrl();
        this.audio.src = '';
        this.audio.removeAttribute('src');
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
    }

    destroy(): void {
        this.cancelRamp(false);
        this.destroyHls();
        this.reset();
        this.removeAllListeners();
    }

    // ─── Private Methods ───

    private bindEvents(): void {
        this.audio.onplaying = () => {
            this.setPlayerState(PlayerState.Playing);
            navigator.mediaSession.playbackState = 'playing';
        };

        this.audio.onpause = () => {
            this.setPlayerState(PlayerState.Paused);
            navigator.mediaSession.playbackState = 'paused';
        };

        this.audio.onerror = (event) => {
            this.setPlayerState(PlayerState.Paused);
            this.emit('error', ErrorReason.EmptyResource, event);
        };

        this.audio.ontimeupdate = () => {
            this.emit('timeUpdate', {
                currentTime: this.audio.currentTime,
                duration: this.audio.duration,
            });
        };

        this.audio.onended = () => {
            this.setPlayerState(PlayerState.Paused);
            this.emit('ended', {
                currentTime: this.audio.currentTime,
                duration: this.audio.duration,
            });
        };

        this.audio.onratechange = () => {
            this.emit('speedChange', this.audio.playbackRate);
        };
    }

    private applyVolume(): void {
        this.audio.volume = clamp01(this._userVolume * this._gain);
    }

    /** 取消进行中的渐变；snapToTarget = 直接落到渐变目标值 */
    private cancelRamp(snapToTarget: boolean): void {
        const ramp = this._ramp;
        if (!ramp) return;
        this._ramp = null;
        clearInterval(ramp.timer);
        if (snapToTarget) {
            this._gain = ramp.target;
            this.applyVolume();
        }
        ramp.resolve(false);
    }

    private setPlayerState(state: PlayerState): void {
        if (this._playerState !== state) {
            this._playerState = state;
            this.emit('stateChange', state);
        }
    }

    // ─── HLS ───

    private initHls(): void {
        this.destroyHls();
        this.hls = new Hls();
        this.hls.attachMedia(this.audio);

        this.hls.on(Hls.Events.ERROR, (_event: any, data: any) => {
            if (data.fatal) {
                this.emit('error', ErrorReason.EmptyResource, data);
            }
        });
    }

    private destroyHls(): void {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
    }

    private isHls(url: string): boolean {
        try {
            const pathname = new URL(url).pathname;
            return pathname.endsWith('.m3u8');
        } catch {
            return url.includes('.m3u8');
        }
    }

    private revokeBlobUrl(): void {
        if (this._currentBlobUrl) {
            URL.revokeObjectURL(this._currentBlobUrl);
            this._currentBlobUrl = null;
        }
    }

    /** 从 URL 的 userinfo 部分提取 Basic Auth 凭证 */
    private extractBasicAuth(url: string): { cleanUrl: string; authHeader?: string } {
        try {
            const parsed = new URL(url);
            if (parsed.username) {
                const auth =
                    'Basic ' +
                    btoa(
                        decodeURIComponent(parsed.username) +
                            ':' +
                            decodeURIComponent(parsed.password),
                    );
                parsed.username = '';
                parsed.password = '';
                return { cleanUrl: parsed.href, authHeader: auth };
            }
        } catch {
            /* not a valid URL, skip */
        }
        return { cleanUrl: url };
    }

    private buildHeaders(source: IPlugin.IMediaSourceResult): Record<string, string> | null {
        const headers: Record<string, string> = {};
        if (source.headers) {
            Object.assign(headers, source.headers);
        }
        if (source.userAgent) {
            headers['User-Agent'] = source.userAgent;
        }
        return Object.keys(headers).length > 0 ? headers : null;
    }
}

// ─── 工厂模式 ───

export type AudioControllerFactory = () => IAudioController;

const controllerFactories: Record<string, AudioControllerFactory> = {
    'web-audio': () => new WebAudioController(),
    // 未来：
    // 'mpv': () => new MpvAudioController(),
};

export function createAudioController(type = 'web-audio'): IAudioController {
    const factory = controllerFactories[type];
    if (!factory) throw new Error(`Unknown audio controller: ${type}`);
    return factory();
}
