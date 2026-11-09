import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decide, emptyState, hysteresisCandidate, rawTier, reserveOf, roundUp1, type BatteryState } from './battery';

const T0 = Date.parse('2026-11-09T12:00:00.000Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const ok = (score: number, nowMs: number, coverage = 0.8) => ({ score, valid: true, coverage, nowMs });

/** Feed a series of (score) every 15 minutes starting at T0 + offset. */
function run(scores: number[], start: BatteryState = emptyState(), startMs = T0) {
  let state = start;
  let last = decide(state, ok(scores[0], startMs));
  state = last.state;
  const out = [last];
  for (let i = 1; i < scores.length; i++) {
    last = decide(state, ok(scores[i], startMs + i * 15 * MIN));
    state = last.state;
    out.push(last);
  }
  return out;
}

describe('rounding and tiers', () => {
  it('rounds the score up to one decimal', () => {
    assert.equal(roundUp1(53.01), 53.1);
    assert.equal(roundUp1(53.0), 53.0);
    assert.equal(roundUp1(44.91), 45.0);
  });
  it('maps scores to the agreed tiers', () => {
    assert.deepEqual([30, 44.9, 45, 54.9, 55, 65, 75, 85, 99].map((s) => reserveOf(rawTier(s))), [30, 30, 40, 40, 50, 65, 80, 90, 90]);
  });
  it('hysteresis needs 2 points beyond the boundary, down one tier at a time', () => {
    assert.equal(hysteresisCandidate(1, 56.9), 1);
    assert.equal(hysteresisCandidate(1, 57), 2);
    assert.equal(hysteresisCandidate(2, 54), 2);
    assert.equal(hysteresisCandidate(2, 53), 1);
    assert.equal(hysteresisCandidate(4, 10), 3); // never skips down
    assert.equal(hysteresisCandidate(0, 90), 5); // may jump up
  });
});

describe('decide', () => {
  it('initialises from the raw tier (today ~53.3 → 40 %)', () => {
    const [d] = run([53.3]);
    assert.equal(d.reserve, 40);
    assert.deepEqual(d.events, ['init']);
  });

  it('does not flap around a boundary', () => {
    const out = run([53.3, 55.5, 54.2, 56.8, 55.1, 56.9, 54.0, 55.9]);
    assert.ok(out.every((d) => d.reserve === 40));
  });

  it('goes up only after 3 consecutive confirmations', () => {
    const out = run([53.3, 58, 58, 58]);
    assert.deepEqual(out.map((d) => d.reserve), [40, 40, 40, 50]);
    assert.ok(out[3].events.includes('tier_change'));
  });

  it('a one-reading spike resets the confirmation count', () => {
    const out = run([53.3, 58, 53, 58, 58]);
    assert.ok(out.every((d) => d.reserve === 40));
  });

  it('after a >20 point jump in an hour it needs 5 confirmations', () => {
    const out = run([50, 50, 50, 50, 50, 75, 75, 75, 75, 75]);
    // the jump is seen against the reading one hour earlier (index 5 vs index 1)
    assert.equal(out[7].reserve, 40);
    assert.equal(out[9].reserve, 65);
  });

  it('going down waits for the 12 h dwell and drops one tier only', () => {
    let state = emptyState();
    let d = decide(state, ok(70, T0)); // init tier 65 %
    state = d.state;
    // low score for 6 h: confirmed but dwell not reached
    for (let i = 1; i <= 24; i++) {
      d = decide(state, ok(40, T0 + i * 15 * MIN));
      state = d.state;
    }
    assert.equal(d.reserve, 65);
    assert.match(d.reason, /12 h dwell/);
    // past 12 h: one tier down (to 50 %), not straight to 30
    for (let i = 25; i <= 52; i++) {
      d = decide(state, ok(40, T0 + i * 15 * MIN));
      state = d.state;
    }
    assert.equal(d.reserve, 50);
  });

  it('holds and never lowers when the indicator is invalid or coverage is low', () => {
    let d = decide(emptyState(), ok(80, T0));
    let state = d.state;
    d = decide(state, { score: 0, valid: false, coverage: 0, nowMs: T0 + 15 * MIN }); // the API returns 0 / green with no sources
    assert.equal(d.hold, true);
    assert.equal(d.reserve, 80);
    state = d.state;
    d = decide(state, { score: 10, valid: true, coverage: 0.5, nowMs: T0 + 30 * MIN });
    assert.equal(d.hold, true);
    assert.equal(d.reserve, 80);
  });

  it('warns after 2 h and urgently after 24 h without a reliable reading, once each, and announces recovery', () => {
    let state = decide(emptyState(), ok(60, T0)).state;
    const events: string[] = [];
    for (let m = 15; m <= 25 * 60; m += 15) {
      const d = decide(state, { score: 0, valid: false, coverage: 0, nowMs: T0 + m * MIN });
      events.push(...d.events);
      state = d.state;
    }
    assert.deepEqual(events, ['hold_2h', 'hold_24h']);
    const back = decide(state, ok(60, T0 + 26 * HOUR));
    assert.ok(back.events.includes('hold_cleared'));
  });

  it('caps tier changes at 4 per day', () => {
    const state: BatteryState = { ...emptyState(), tier: 1, sinceMs: T0 - 13 * HOUR, changeTimes: [T0 - 20 * HOUR, T0 - 10 * HOUR, T0 - 5 * HOUR, T0 - 2 * HOUR] };
    let s = state;
    let d = decide(s, ok(70, T0));
    for (let i = 1; i <= 4; i++) {
      s = d.state;
      d = decide(s, ok(70, T0 + i * 15 * MIN));
    }
    assert.equal(d.reserve, 40);
    assert.match(d.reason, /daily change limit/);
    // once the oldest change is more than 24 h old the move goes through
    const later = decide(d.state, ok(70, T0 + 5 * HOUR));
    assert.equal(later.reserve, 65);
  });
});
