/**
 * Quick checks for the Soundtrack next-track selector (no test framework in this repo).
 *
 * Run: node --no-warnings scripts/test-context-selector.mts   (Node >= 23.6 strips types)
 */
import assert from 'node:assert/strict';

import {
    recentWindowSize,
    selectNextTrack,
    toPlayedEntry,
    trackKeyOf,
    type IPlayedEntry,
} from '../src/renderer/mainWindow/core/contextPlayback/selector.ts';

interface ITrack {
    platform: string;
    id: string;
    artist: string;
}

/** Deterministic random source (LCG) */
function seeded(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
}

function makePool(n: number, artists = n): ITrack[] {
    return Array.from({ length: n }, (_, i) => ({
        platform: 'local',
        id: `t${i}`,
        artist: `Artist ${i % artists}`,
    }));
}

/** History, most recent first */
function history(tracks: ITrack[]): IPlayedEntry[] {
    return tracks.map(toPlayedEntry);
}

let passed = 0;
function test(name: string, fn: () => void) {
    fn();
    passed++;
    console.log(`ok - ${name}`);
}

test('empty pool → null', () => {
    const r = selectNextTrack([] as ITrack[], { recent: [] });
    assert.equal(r.track, null);
    assert.equal(r.poolSize, 0);
});

test('pool of one → that track, even if it is playing', () => {
    const [only] = makePool(1);
    const r = selectNextTrack([only], { recent: history([only]), currentKey: trackKeyOf(only) });
    assert.equal(r.track, only);
});

test('duplicates in the pool count once', () => {
    const pool = makePool(3);
    const r = selectNextTrack([...pool, ...pool], { recent: [] });
    assert.equal(r.poolSize, 3);
});

test('window size: min(20, 30% of pool)', () => {
    assert.equal(recentWindowSize(1), 0);
    assert.equal(recentWindowSize(4), 1);
    assert.equal(recentWindowSize(10), 3);
    assert.equal(recentWindowSize(100), 20);
});

test('never picks the current track when there is a choice', () => {
    const pool = makePool(2);
    const random = seeded(1);
    for (let i = 0; i < 200; i++) {
        const r = selectNextTrack(pool, { recent: [], currentKey: trackKeyOf(pool[0]), random });
        assert.equal(r.track, pool[1]);
    }
});

test('excludes the last min(20, 30%) played pool tracks', () => {
    const pool = makePool(10); // window = 3
    // played: t9 (most recent), x (not in pool), t8, t7, t6
    const recent: IPlayedEntry[] = [
        toPlayedEntry(pool[9]),
        { key: 'other\0x', artist: 'nobody' },
        toPlayedEntry(pool[8]),
        toPlayedEntry(pool[7]),
        toPlayedEntry(pool[6]),
    ];
    const random = seeded(2);
    const picked = new Set<string>();
    for (let i = 0; i < 500; i++) {
        const r = selectNextTrack(pool, { recent, random, artistCooldown: 0 });
        assert.equal(r.excludedRecent, 3);
        picked.add(r.track!.id);
    }
    for (const id of ['t9', 't8', 't7']) assert.ok(!picked.has(id), `${id} should be excluded`);
    assert.ok(picked.has('t6'), 't6 is outside the window and may be picked');
});

test('artist cooldown: skips artists of the last 3 plays', () => {
    const pool = makePool(30, 6); // 6 artists, 5 tracks each
    const recent = history([pool[0], pool[1], pool[2]]); // Artist 0, 1, 2
    const random = seeded(3);
    for (let i = 0; i < 300; i++) {
        const r = selectNextTrack(pool, { recent, random });
        assert.ok(r.artistCooldownApplied);
        assert.ok(!['Artist 0', 'Artist 1', 'Artist 2'].includes(r.track!.artist));
    }
});

test('artist cooldown is case-insensitive and ignores unknown artists', () => {
    const pool: ITrack[] = [
        { platform: 'local', id: 'a', artist: 'ABBA' },
        { platform: 'local', id: 'b', artist: '' },
        { platform: 'local', id: 'c', artist: 'Queen' },
    ];
    const recent: IPlayedEntry[] = [
        { key: 'x\0old', artist: 'abba ' },
        { key: 'x\0old2', artist: '' },
    ];
    const random = seeded(4);
    const picked = new Set<string>();
    for (let i = 0; i < 200; i++) {
        picked.add(selectNextTrack(pool, { recent, random }).track!.id);
    }
    assert.deepEqual([...picked].sort(), ['b', 'c']);
});

test('artist cooldown is skipped when it leaves nothing (small pool)', () => {
    const pool = makePool(3, 1); // all by Artist 0
    const recent = history([pool[0]]);
    const r = selectNextTrack(pool, { recent, currentKey: trackKeyOf(pool[0]), random: seeded(5) });
    assert.ok(r.track);
    assert.notEqual(r.track!.id, 't0');
    assert.equal(r.artistCooldownApplied, false);
});

test('weights: unplayed tracks beat recently played ones', () => {
    // pool 10, window 3. t3 played 4th most recently (just outside the window) → low weight
    const pool = makePool(10);
    const recent = history([pool[0], pool[1], pool[2], pool[3]]);
    const random = seeded(6);
    const counts = new Map<string, number>();
    const N = 20000;
    for (let i = 0; i < N; i++) {
        const id = selectNextTrack(pool, { recent, random, artistCooldown: 0 }).track!.id;
        counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const unplayedAvg =
        ['t4', 't5', 't6', 't7', 't8', 't9'].reduce((sum, id) => sum + (counts.get(id) ?? 0), 0) /
        6;
    const t3 = counts.get('t3') ?? 0;
    assert.ok(t3 > 0, 't3 is still possible');
    assert.ok(t3 < unplayedAvg * 0.9, `t3 (${t3}) should be rarer than unplayed (${unplayedAvg})`);
});

test('weightOf: zero weight only when nothing else', () => {
    const pool = makePool(4);
    const random = seeded(7);
    const weightOf = (t: ITrack) => (t.id === 't1' ? 1 : 0);
    for (let i = 0; i < 100; i++) {
        assert.equal(selectNextTrack(pool, { recent: [], random, weightOf }).track!.id, 't1');
    }
    const allZero = selectNextTrack(pool, { recent: [], random, weightOf: () => 0 });
    assert.ok(allZero.track, 'all-zero weights still pick a track');
});

test('long run: no immediate repeats, every track gets played', () => {
    const pool = makePool(12, 4);
    const random = seeded(8);
    let recent: IPlayedEntry[] = [];
    let current: ITrack | null = null;
    const played = new Set<string>();
    for (let i = 0; i < 300; i++) {
        const r = selectNextTrack(pool, {
            recent,
            currentKey: current ? trackKeyOf(current) : null,
            random,
        });
        const next = r.track!;
        if (current) assert.notEqual(next.id, current.id);
        played.add(next.id);
        current = next;
        recent = [toPlayedEntry(next), ...recent].slice(0, 50);
    }
    assert.equal(played.size, 12);
});

console.log(`\n${passed} tests passed`);
