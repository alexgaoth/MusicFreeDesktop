/**
 * contextPlayback — next-track selector (pure)
 *
 * Picks the next track for Soundtrack mode from the current context's pool.
 * No DOM / Electron / alias imports, so plain node scripts can import it
 * (see scripts/test-context-selector.mts).
 *
 * Rules, in order:
 *   1. Pool = unique tracks (platform + id).
 *   2. Anti-repeat: drop the current track (pool > 1) and the last
 *      min(maxRecentExclude, floor(pool × recentExcludeRatio)) pool tracks that were played.
 *   3. Artist cooldown: drop tracks by the artists of the last `artistCooldown` plays.
 *      Skipped when it would leave no candidate (small pool).
 *   4. Weighted random: weight = weightOf(track) × age factor. Tracks not in the history
 *      get factor 1; played tracks get 0.3 … 1, older plays closer to 1.
 */

export interface ISelectableTrack {
    platform: string;
    id: string;
    artist?: string | null;
}

/** One play in the history (most recent first in arrays) */
export interface IPlayedEntry {
    key: string;
    artist: string;
}

export interface ISelectOptions<T extends ISelectableTrack> {
    /** Play history, most recent first. May contain keys that are not in the pool. */
    recent: readonly IPlayedEntry[];
    /** Key of the track that is playing now (excluded when the pool has more than one track) */
    currentKey?: string | null;
    /** Random source in [0, 1). Default Math.random. */
    random?: () => number;
    /** Base weight per track (default 1). Weight <= 0 means "only if nothing else". */
    weightOf?: (track: T) => number;
    /** Default 20 */
    maxRecentExclude?: number;
    /** Default 0.3 */
    recentExcludeRatio?: number;
    /** Number of last plays whose artists are on cooldown. Default 3. */
    artistCooldown?: number;
}

export interface ISelectResult<T> {
    /** null when the pool is empty */
    track: T | null;
    /** Unique tracks in the pool */
    poolSize: number;
    /** Tracks dropped by the anti-repeat window (current track not counted) */
    excludedRecent: number;
    /** false when the artist cooldown was skipped because it left no candidate */
    artistCooldownApplied: boolean;
    /** Candidates after all filters */
    candidates: number;
}

/** Same format as compositeKey() in @common/mediaKey */
export function trackKeyOf(track: { platform: string; id: string | number }): string {
    return `${track.platform}\0${String(track.id)}`;
}

/** Artist name for cooldown comparison; '' = unknown (never on cooldown) */
export function normalizeArtist(artist: string | null | undefined): string {
    return (artist ?? '').trim().toLowerCase();
}

/** Played-entry for the history */
export function toPlayedEntry(track: ISelectableTrack): IPlayedEntry {
    return { key: trackKeyOf(track), artist: normalizeArtist(track.artist) };
}

/** Size of the anti-repeat window for a pool */
export function recentWindowSize(poolSize: number, maxRecent = 20, ratio = 0.3): number {
    return Math.max(0, Math.min(maxRecent, Math.floor(poolSize * ratio)));
}

export function selectNextTrack<T extends ISelectableTrack>(
    pool: readonly T[],
    options: ISelectOptions<T>,
): ISelectResult<T> {
    const random = options.random ?? Math.random;

    // 1. Unique pool
    const unique: T[] = [];
    const seen = new Set<string>();
    for (const track of pool) {
        const key = trackKeyOf(track);
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(track);
    }
    const poolSize = unique.length;
    if (poolSize === 0) {
        return {
            track: null,
            poolSize: 0,
            excludedRecent: 0,
            artistCooldownApplied: false,
            candidates: 0,
        };
    }

    // History: distinct keys, most recent first, with their position
    const recentPos = new Map<string, number>();
    for (const entry of options.recent) {
        if (!recentPos.has(entry.key)) recentPos.set(entry.key, recentPos.size);
    }

    // 2. Anti-repeat window (pool tracks only)
    const windowSize = recentWindowSize(
        poolSize,
        options.maxRecentExclude ?? 20,
        options.recentExcludeRatio ?? 0.3,
    );
    const excluded = new Set<string>();
    for (const key of recentPos.keys()) {
        if (excluded.size >= windowSize) break;
        if (seen.has(key)) excluded.add(key);
    }
    const excludedRecent = excluded.size;
    if (options.currentKey && poolSize > 1) excluded.add(options.currentKey);

    let candidates = unique.filter((t) => !excluded.has(trackKeyOf(t)));
    if (candidates.length === 0) {
        // Defensive: the window never covers the whole pool, but never return nothing
        candidates =
            poolSize > 1 ? unique.filter((t) => trackKeyOf(t) !== options.currentKey) : unique;
    }

    // 3. Artist cooldown
    const cooldown = new Set<string>();
    for (const entry of options.recent.slice(0, options.artistCooldown ?? 3)) {
        const artist = normalizeArtist(entry.artist);
        if (artist) cooldown.add(artist);
    }
    let artistCooldownApplied = false;
    if (cooldown.size > 0) {
        const filtered = candidates.filter((t) => !cooldown.has(normalizeArtist(t.artist)));
        if (filtered.length > 0) {
            artistCooldownApplied = filtered.length < candidates.length;
            candidates = filtered;
        }
    }

    // 4. Weighted random
    const historySize = Math.max(1, recentPos.size);
    const weights = candidates.map((t) => {
        const base = options.weightOf ? options.weightOf(t) : 1;
        if (!(base > 0)) return 0;
        const pos = recentPos.get(trackKeyOf(t));
        const age = pos === undefined ? 1 : 0.3 + 0.7 * Math.min(1, pos / historySize);
        return base * age;
    });
    const total = weights.reduce((sum, w) => sum + w, 0);

    let track: T;
    if (total <= 0) {
        track =
            candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
    } else {
        let r = random() * total;
        // Float rounding guard: default to the last track with a positive weight
        let index = weights.length - 1;
        while (index > 0 && !(weights[index] > 0)) index--;
        for (let i = 0; i < weights.length; i++) {
            r -= weights[i];
            if (r < 0) {
                index = i;
                break;
            }
        }
        track = candidates[index];
    }

    return {
        track,
        poolSize,
        excludedRecent,
        artistCooldownApplied,
        candidates: candidates.length,
    };
}
