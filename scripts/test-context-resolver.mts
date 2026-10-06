/**
 * Quick checks for the context resolver (no test framework in this repo).
 *
 * Run: node --no-warnings scripts/test-context-resolver.mts   (Node >= 23.6 strips types)
 */
import assert from 'node:assert/strict';

import {
    INITIAL_RESOLVER_STATE,
    matchRules,
    sanitizeRules,
    step,
    type IResolverOptions,
    type IResolverState,
} from '../src/infra/contextEngine/main/resolver.ts';
import { DEFAULT_CONTEXTS, DEFAULT_RULES } from '../src/infra/contextEngine/common/defaults.ts';
import type { IContextRule, IContextSignals } from '../src/types/infra/contextEngine/index.d.ts';

const T0 = new Date(2026, 9, 6, 10, 0, 0).getTime(); // Tue 2026-10-06 10:00 local
const SEC = 1000;

const XCODE = { bundleId: 'com.apple.dt.Xcode', name: 'Xcode' };
const SLACK = { bundleId: 'com.tinyspeck.slackmacgap', name: 'Slack' };
const FINDER = { bundleId: 'com.apple.finder', name: 'Finder' };

const options: IResolverOptions = {
    debounceSec: 45,
    minDwellSec: 300,
    defaultContextId: 'work',
    manualOverride: null,
};

function sig(partial: Partial<IContextSignals> & { at: number }): IContextSignals {
    return { micInUse: false, idleSec: 0, now: partial.at, ...partial };
}

let passed = 0;
function test(name: string, fn: () => void) {
    fn();
    passed++;
    console.log(`ok - ${name}`);
}

// ─── matchRules ───

test('default rules: app, mic, idle, fallback', () => {
    assert.equal(matchRules(sig({ at: T0, app: XCODE }), DEFAULT_RULES)?.contextId, 'focus');
    assert.equal(matchRules(sig({ at: T0, app: SLACK }), DEFAULT_RULES)?.contextId, 'comms');
    assert.equal(matchRules(sig({ at: T0, app: FINDER }), DEFAULT_RULES), null);
    // mic wins over the app rule
    const mic = matchRules(sig({ at: T0, app: XCODE, micInUse: true }), DEFAULT_RULES);
    assert.deepEqual(mic, { contextId: 'comms', ruleId: 'default-mic', ruleKind: 'mic' });
    // idle wins over the app rule
    const idle = matchRules(sig({ at: T0, app: XCODE, idleSec: 300 }), DEFAULT_RULES);
    assert.equal(idle?.contextId, 'idle');
    assert.equal(
        matchRules(sig({ at: T0, app: XCODE, idleSec: 299 }), DEFAULT_RULES)?.ruleKind,
        'app',
    );
});

test('bundle ids match case-insensitively; disabled rules are skipped', () => {
    const rules: IContextRule[] = [
        {
            id: 'off',
            contextId: 'break',
            match: { kind: 'app', bundleIds: ['com.apple.finder'] },
            enabled: false,
        },
        { id: 'on', contextId: 'work', match: { kind: 'app', bundleIds: ['COM.APPLE.FINDER'] } },
    ];
    assert.equal(matchRules(sig({ at: T0, app: FINDER }), rules)?.ruleId, 'on');
});

test('time rules: plain window, overnight wrap, days', () => {
    const lunch: IContextRule[] = [
        {
            id: 'lunch',
            contextId: 'break',
            match: { kind: 'time', from: '12:00', to: '13:00', days: [1, 2, 3, 4, 5] },
        },
    ];
    const at = (h: number, m: number, day = 6) => new Date(2026, 9, day, h, m).getTime();
    assert.ok(matchRules(sig({ at: at(12, 0) }), lunch));
    assert.ok(matchRules(sig({ at: at(12, 59) }), lunch));
    assert.equal(matchRules(sig({ at: at(13, 0) }), lunch), null);
    assert.equal(matchRules(sig({ at: at(12, 30, 4) }), lunch), null); // Sunday 2026-10-04

    // Friday night 22:00 → 02:00 belongs to Friday, also after midnight (Saturday)
    const night: IContextRule[] = [
        {
            id: 'night',
            contextId: 'break',
            match: { kind: 'time', from: '22:00', to: '02:00', days: [5] },
        },
    ];
    assert.ok(matchRules(sig({ at: at(23, 0, 9) }), night)); // Fri 2026-10-09
    assert.ok(matchRules(sig({ at: at(1, 30, 10) }), night)); // Sat 01:30
    assert.equal(matchRules(sig({ at: at(1, 30, 9) }), night), null); // Fri 01:30 = Thu night
    assert.equal(matchRules(sig({ at: at(12, 0, 9) }), night), null);
});

test('sanitizeRules drops unknown contexts and malformed rules', () => {
    const rules = [
        ...DEFAULT_RULES,
        { id: 'x', contextId: 'nope', match: { kind: 'mic' } },
        { id: 'y', contextId: 'work', match: { kind: 'weird' } },
        { id: 'z', contextId: 'work' },
        null,
    ];
    assert.equal(sanitizeRules(rules, DEFAULT_CONTEXTS).length, DEFAULT_RULES.length);
    assert.deepEqual(sanitizeRules('bad', DEFAULT_CONTEXTS), []);
});

// ─── step() ───

/** Run a timeline of signals and return all commits */
function run(timeline: IContextSignals[], opts = options) {
    let state: IResolverState = INITIAL_RESOLVER_STATE;
    const commits = [];
    let lastWake: number | null = null;
    for (const s of timeline) {
        const res = step(state, s, DEFAULT_RULES, opts);
        state = res.state;
        lastWake = res.wakeAt;
        if (res.commit) commits.push(res.commit);
    }
    return { state, commits, lastWake };
}

test('first evaluation commits at once with reason initial', () => {
    const { commits } = run([sig({ at: T0, app: XCODE })]);
    assert.equal(commits.length, 1);
    assert.equal(commits[0].contextId, 'focus');
    assert.equal(commits[0].previousId, null);
    assert.equal(commits[0].reason, 'initial');
    assert.equal(commits[0].urgent, false);
});

test('debounce: a short switch does not commit', () => {
    const { commits, state } = run([
        sig({ at: T0, app: XCODE }),
        sig({ at: T0 + 400 * SEC, app: SLACK }),
        sig({ at: T0 + 430 * SEC, app: XCODE }), // back after 30 s
        sig({ at: T0 + 500 * SEC, app: XCODE }),
    ]);
    assert.equal(commits.length, 1);
    assert.equal(state.candidate, null);
});

test('debounce: a switch that persists commits after debounceSec', () => {
    const r1 = run([sig({ at: T0, app: XCODE }), sig({ at: T0 + 400 * SEC, app: SLACK })]);
    assert.equal(r1.commits.length, 1);
    assert.equal(r1.state.candidate?.contextId, 'comms');
    assert.equal(r1.lastWake, T0 + 445 * SEC);

    const r2 = run([
        sig({ at: T0, app: XCODE }),
        sig({ at: T0 + 400 * SEC, app: SLACK }),
        sig({ at: T0 + 445 * SEC, app: SLACK }),
    ]);
    assert.equal(r2.commits.length, 2);
    assert.deepEqual(
        {
            id: r2.commits[1].contextId,
            prev: r2.commits[1].previousId,
            reason: r2.commits[1].reason,
        },
        { id: 'comms', prev: 'focus', reason: 'rule' },
    );
});

test('dwell: no non-urgent commit within minDwellSec of the last commit', () => {
    // Commit focus by rule at T0 (after an initial fallback commit), then try to leave early.
    const start = [
        sig({ at: T0 - 100 * SEC, app: FINDER }),
        sig({ at: T0 - 50 * SEC, app: XCODE }),
        sig({ at: T0, app: XCODE }),
    ];
    const r = run([
        ...start,
        sig({ at: T0 + 60 * SEC, app: SLACK }),
        sig({ at: T0 + 200 * SEC, app: SLACK }), // debounce done, dwell not
    ]);
    assert.equal(r.commits.length, 2);
    assert.equal(r.commits[1].at, T0);
    assert.equal(r.lastWake, T0 + 300 * SEC);
    const r2 = run([
        ...start,
        sig({ at: T0 + 60 * SEC, app: SLACK }),
        sig({ at: T0 + 300 * SEC, app: SLACK }),
    ]);
    assert.equal(r2.commits.length, 3);
});

test('initial commit is provisional: leaving it needs the debounce only', () => {
    const r = run([
        sig({ at: T0, app: FINDER }),
        sig({ at: T0 + 5 * SEC, app: XCODE }),
        sig({ at: T0 + 50 * SEC, app: XCODE }),
    ]);
    assert.deepEqual(
        r.commits.map((c) => [c.contextId, c.reason]),
        [
            ['work', 'initial'],
            ['focus', 'rule'],
        ],
    );
});

test('fallback: unknown app goes to defaultContextId', () => {
    const r = run([
        sig({ at: T0, app: XCODE }),
        sig({ at: T0 + 400 * SEC, app: FINDER }),
        sig({ at: T0 + 445 * SEC, app: FINDER }),
    ]);
    assert.equal(r.commits[1].contextId, 'work');
    assert.equal(r.commits[1].reason, 'fallback');
});

test('urgent: mic commits at once, ignoring debounce and dwell; leaving is immediate too', () => {
    const r = run([
        sig({ at: T0, app: XCODE }),
        sig({ at: T0 + 10 * SEC, app: XCODE, micInUse: true }),
        sig({ at: T0 + 70 * SEC, app: XCODE, micInUse: false }),
    ]);
    assert.equal(r.commits.length, 3);
    assert.deepEqual(
        r.commits.map((c) => [c.contextId, c.urgent, c.ruleKind]),
        [
            ['focus', false, 'app'],
            ['comms', true, 'mic'],
            ['focus', false, 'app'],
        ],
    );
});

test('urgent: mic start/stop re-commits even when the context id stays the same', () => {
    const r = run([
        sig({ at: T0, app: SLACK }),
        sig({ at: T0 + 10 * SEC, app: SLACK, micInUse: true }),
        sig({ at: T0 + 20 * SEC, app: SLACK, micInUse: false }),
    ]);
    assert.deepEqual(
        r.commits.map((c) => [c.contextId, c.previousId, c.urgent]),
        [
            ['comms', null, false],
            ['comms', 'comms', true],
            ['comms', 'comms', false],
        ],
    );
});

test('idle: entering is debounced, leaving is immediate', () => {
    const r = run([
        sig({ at: T0, app: XCODE }),
        sig({ at: T0 + 600 * SEC, app: XCODE, idleSec: 300 }),
        sig({ at: T0 + 645 * SEC, app: XCODE, idleSec: 345 }),
        sig({ at: T0 + 700 * SEC, app: XCODE, idleSec: 2 }),
    ]);
    assert.deepEqual(
        r.commits.map((c) => [c.contextId, c.at]),
        [
            ['focus', T0],
            ['idle', T0 + 645 * SEC],
            ['focus', T0 + 700 * SEC],
        ],
    );
});

test('manual override wins at once, unlock returns at once', () => {
    let state: IResolverState = INITIAL_RESOLVER_STATE;
    const locked = { ...options, manualOverride: 'break' };
    state = step(state, sig({ at: T0, app: XCODE }), DEFAULT_RULES, options).state;
    let res = step(state, sig({ at: T0 + SEC, app: XCODE }), DEFAULT_RULES, locked);
    assert.equal(res.commit?.contextId, 'break');
    assert.equal(res.commit?.reason, 'manual');
    // mic does not break the lock
    res = step(
        res.state,
        sig({ at: T0 + 2 * SEC, app: XCODE, micInUse: true }),
        DEFAULT_RULES,
        locked,
    );
    assert.equal(res.commit, null);
    // unlock
    res = step(res.state, sig({ at: T0 + 3 * SEC, app: XCODE }), DEFAULT_RULES, options);
    assert.equal(res.commit?.contextId, 'focus');
});

test('candidate keeps its start time while the target stays the same', () => {
    const r = run([
        sig({ at: T0, app: XCODE }),
        sig({ at: T0 + 400 * SEC, app: SLACK }),
        sig({ at: T0 + 420 * SEC, app: { bundleId: 'com.apple.mail', name: 'Mail' } }),
    ]);
    assert.equal(r.state.candidate?.since, T0 + 400 * SEC);
    assert.equal(r.lastWake, T0 + 445 * SEC);
});

console.log(`\n${passed} tests passed`);
