import type { SeverityBand, SourceReading } from './types';

/**
 * Map a normalized 0..100 score to a Risk-style band.
 * Tuned so that "elevated tension" is yellow and "active escalation" is red.
 */
export function bandFor(score: number): SeverityBand {
  if (score >= 66) return 'red';
  if (score >= 33) return 'yellow';
  return 'green';
}

/**
 * Piecewise-linear normalization from a raw value into 0..100.
 * `breakpoints` are pairs of (raw -> score) and MUST be sorted by raw asc.
 * Direction is inferred from the breakpoint scores (handles inverse metrics
 * like USD index where stronger USD can be "fear bid").
 */
export function piecewise(value: number, breakpoints: Array<[number, number]>): number {
  if (breakpoints.length < 2) {
    throw new Error('piecewise requires at least 2 breakpoints');
  }
  const first = breakpoints[0];
  const last = breakpoints[breakpoints.length - 1];
  if (value <= first[0]) return clamp(first[1]);
  if (value >= last[0]) return clamp(last[1]);
  for (let i = 1; i < breakpoints.length; i++) {
    const [x0, y0] = breakpoints[i - 1];
    const [x1, y1] = breakpoints[i];
    if (value <= x1) {
      const t = (value - x0) / (x1 - x0);
      return clamp(y0 + t * (y1 - y0));
    }
  }
  return clamp(last[1]);
}

export function clamp(n: number, lo = 0, hi = 100): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Build a SourceReading from a fetched raw value with the standard scaffolding.
 */
export function reading(args: {
  sourceId: string;
  raw: number | string | null;
  score: number;
  rationale: string;
  rawUnit?: string;
  meta?: Record<string, unknown>;
}): SourceReading {
  const score = clamp(args.score);
  return {
    sourceId: args.sourceId,
    score,
    raw: args.raw,
    rawUnit: args.rawUnit,
    band: bandFor(score),
    rationale: args.rationale,
    measuredAt: new Date().toISOString(),
    ok: true,
    meta: args.meta,
  };
}

export function errorReading(sourceId: string, error: unknown): SourceReading {
  const msg = error instanceof Error ? error.message : String(error);
  return {
    sourceId,
    score: 0,
    raw: null,
    band: 'green',
    rationale: `Fetch failed: ${msg}`,
    measuredAt: new Date().toISOString(),
    ok: false,
    error: msg,
  };
}
