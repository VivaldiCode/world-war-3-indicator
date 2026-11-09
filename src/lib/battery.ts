/**
 * Battery reserve recommendation driven by the global tension index (HOMEL-465/469).
 *
 * SHADOW MODE: this module only RECOMMENDS. Nothing in this repo writes to the
 * battery; the Home Assistant side (behind a write switch that is off by
 * default) is a separate, owner-gated step. Pure functions, no I/O.
 */

export const MIN_RESERVE = 30;
export const MAX_RESERVE = 90;

/** `min` is the score at which the tier starts (before hysteresis). */
export const TIERS: ReadonlyArray<{ min: number; reserve: number }> = [
  { min: -Infinity, reserve: 30 },
  { min: 45, reserve: 40 },
  { min: 55, reserve: 50 },
  { min: 65, reserve: 65 },
  { min: 75, reserve: 80 },
  { min: 85, reserve: 90 },
];

export const HYSTERESIS = 2; // points beyond the boundary
export const CONFIRMATIONS = 3; // consecutive evaluations (~45 min at 15 min)
export const JUMP_CONFIRMATIONS = 5; // when the score moved > 20 in the last hour
export const JUMP_POINTS = 20;
export const DOWN_DWELL_MS = 12 * 3600 * 1000;
export const MAX_CHANGES_PER_DAY = 4;
export const MIN_COVERAGE = 0.6;
export const HOLD_WARN_MS = 2 * 3600 * 1000;
export const HOLD_URGENT_MS = 24 * 3600 * 1000;

export interface BatteryState {
  tier: number | null;
  sinceMs: number;
  pendingTier: number | null;
  pendingCount: number;
  lastScores: Array<{ t: number; score: number }>;
  changeTimes: number[];
  holdSinceMs: number | null;
  holdWarned: 0 | 1 | 2;
}

export interface BatteryInput {
  score: number;
  valid: boolean;
  coverage: number;
  nowMs: number;
}

export type BatteryEvent = 'init' | 'tier_change' | 'hold_2h' | 'hold_24h' | 'hold_cleared';

export interface BatteryDecision {
  reserve: number;
  tier: number;
  hold: boolean;
  reason: string;
  events: BatteryEvent[];
  state: BatteryState;
}

export function emptyState(): BatteryState {
  return { tier: null, sinceMs: 0, pendingTier: null, pendingCount: 0, lastScores: [], changeTimes: [], holdSinceMs: null, holdWarned: 0 };
}

/** The spec rounds the score up to one decimal. */
export function roundUp1(score: number): number {
  return Math.ceil(score * 10 - 1e-9) / 10;
}

export function rawTier(score: number): number {
  let t = 0;
  for (let i = 1; i < TIERS.length; i++) if (score >= TIERS[i].min) t = i;
  return t;
}

/** Tier the hysteresis allows from `cur` at this score: up any number of tiers, down one at a time. */
export function hysteresisCandidate(cur: number, score: number): number {
  let cand = cur;
  for (let j = cur + 1; j < TIERS.length; j++) {
    if (score >= TIERS[j].min + HYSTERESIS) cand = j;
    else break;
  }
  if (cand > cur) return cand;
  if (cur > 0 && score <= TIERS[cur].min - HYSTERESIS) return cur - 1;
  return cur;
}

export function reserveOf(tier: number): number {
  return Math.max(MIN_RESERVE, Math.min(MAX_RESERVE, TIERS[tier].reserve));
}

export function decide(prev: BatteryState, input: BatteryInput): BatteryDecision {
  const { nowMs } = input;
  const state: BatteryState = {
    ...prev,
    lastScores: prev.lastScores.filter((p) => nowMs - p.t <= 6 * 3600 * 1000),
    changeTimes: prev.changeTimes.filter((t) => nowMs - t <= 24 * 3600 * 1000),
  };
  const events: BatteryEvent[] = [];
  const currentTier = state.tier ?? 0;

  // Fail-safe: no trustworthy reading → keep what we have, never lower, warn after 2 h / 24 h.
  if (!input.valid || input.coverage < MIN_COVERAGE || !Number.isFinite(input.score)) {
    if (state.holdSinceMs === null) state.holdSinceMs = nowMs;
    const heldMs = nowMs - state.holdSinceMs;
    if (heldMs >= HOLD_URGENT_MS && state.holdWarned < 2) {
      state.holdWarned = 2;
      events.push('hold_24h');
    } else if (heldMs >= HOLD_WARN_MS && state.holdWarned < 1) {
      state.holdWarned = 1;
      events.push('hold_2h');
    }
    state.pendingTier = null;
    state.pendingCount = 0;
    const why = !input.valid ? 'indicator not valid' : input.coverage < MIN_COVERAGE ? `weight coverage ${input.coverage.toFixed(2)} < ${MIN_COVERAGE}` : 'score not finite';
    return { reserve: reserveOf(currentTier), tier: currentTier, hold: true, reason: `hold: ${why}; keeping ${reserveOf(currentTier)} %`, events, state };
  }

  if (state.holdSinceMs !== null) {
    if (state.holdWarned > 0) events.push('hold_cleared');
    state.holdSinceMs = null;
    state.holdWarned = 0;
  }

  const score = roundUp1(input.score);
  const hourAgo = state.lastScores.find((p) => nowMs - p.t >= 55 * 60 * 1000 && nowMs - p.t <= 75 * 60 * 1000);
  const jump = hourAgo ? Math.abs(score - hourAgo.score) > JUMP_POINTS : false;
  state.lastScores = [...state.lastScores, { t: nowMs, score }];

  if (state.tier === null) {
    state.tier = rawTier(score);
    state.sinceMs = nowMs;
    events.push('init');
    return { reserve: reserveOf(state.tier), tier: state.tier, hold: false, reason: `init at score ${score}: ${reserveOf(state.tier)} %`, events, state };
  }

  const cand = hysteresisCandidate(state.tier, score);
  if (cand === state.tier) {
    state.pendingTier = null;
    state.pendingCount = 0;
    return { reserve: reserveOf(state.tier), tier: state.tier, hold: false, reason: `score ${score} inside tier: ${reserveOf(state.tier)} %`, events, state };
  }

  state.pendingCount = state.pendingTier === cand ? state.pendingCount + 1 : 1;
  state.pendingTier = cand;
  const need = jump ? JUMP_CONFIRMATIONS : CONFIRMATIONS;
  const goingDown = cand < state.tier;
  const hold = (why: string): BatteryDecision => ({ reserve: reserveOf(state.tier!), tier: state.tier!, hold: true, reason: why, events, state });

  if (state.pendingCount < need) return hold(`${goingDown ? 'down' : 'up'} to ${reserveOf(cand)} % awaiting confirmation ${state.pendingCount}/${need} (score ${score})`);
  if (goingDown && nowMs - state.sinceMs < DOWN_DWELL_MS) return hold(`down to ${reserveOf(cand)} % waits for the 12 h dwell (score ${score})`);
  if (state.changeTimes.length >= MAX_CHANGES_PER_DAY) return hold(`daily change limit (${MAX_CHANGES_PER_DAY}) reached (score ${score})`);

  state.tier = cand;
  state.sinceMs = nowMs;
  state.pendingTier = null;
  state.pendingCount = 0;
  state.changeTimes = [...state.changeTimes, nowMs];
  events.push('tier_change');
  return { reserve: reserveOf(cand), tier: cand, hold: false, reason: `score ${score} → ${reserveOf(cand)} %`, events, state };
}
