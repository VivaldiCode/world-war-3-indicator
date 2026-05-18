import type { SourceReading } from '../types';
import { fetchYahooSeries, type YahooSeriesPoint } from '../http';
import { bandFor, clamp } from '../scoring';

/**
 * The earliest date we'll persist. The publishers won't reach this far for
 * most instruments, but we clamp anyway so seed data from other backfills
 * (SIPRI 1949+, etc.) sit alongside market data on a consistent floor.
 */
export const WW2_END = '1945-09-02T00:00:00.000Z';

/**
 * For live-only sources (n2yo, OpenWeather, Electricity Maps, Cloudflare
 * Radar, GDELT, ACLED, Wikipedia conflicts) we don't have any historical
 * archive to seed from — backfill is a no-op and the time series populates
 * organically from the scheduled refresher going forward.
 */
export async function noopBackfill() {
  return [];
}

export interface YahooBackfillArgs {
  sourceId: string;
  symbol: string;
  rawUnit: string;
  /**
   * Score a single point using its raw close + an optional 22-day-prior close
   * (so the same "level + momentum" model used at runtime applies historically).
   */
  scoreFor: (close: number, monthAgoClose: number | undefined) => { score: number; rationale: string };
  /** Optional: filter out points before some publisher-specific threshold. */
  earliestUsable?: string;
  /** Optional: thin the daily series (e.g. keep every 5th day to save space). */
  stride?: number;
}

/**
 * Materialise a full historical reading series from a Yahoo symbol.
 * Each daily close becomes a SourceReading whose `measuredAt` is the actual
 * trading-day timestamp — so they slot directly into the time-series DB.
 */
export async function yahooBackfill(args: YahooBackfillArgs, opts: { from?: string; to?: string }): Promise<SourceReading[]> {
  const series: YahooSeriesPoint[] = await fetchYahooSeries(args.symbol);
  const fromMs = opts.from ? Date.parse(opts.from) : Date.parse(WW2_END);
  const toMs = opts.to ? Date.parse(opts.to) : Date.now();
  const earliestMs = args.earliestUsable ? Date.parse(args.earliestUsable) : -Infinity;
  const stride = Math.max(1, args.stride ?? 1);
  const out: SourceReading[] = [];
  for (let i = 0; i < series.length; i += stride) {
    const p = series[i];
    const t = Date.parse(p.date);
    if (!Number.isFinite(t)) continue;
    if (t < fromMs || t > toMs || t < earliestMs) continue;
    const monthAgo = series[i - 22]?.close;
    const { score, rationale } = args.scoreFor(p.close, monthAgo);
    const clamped = clamp(score);
    out.push({
      sourceId: args.sourceId,
      measuredAt: new Date(t).toISOString(),
      raw: p.close,
      rawUnit: args.rawUnit,
      score: clamped,
      band: bandFor(clamped),
      rationale,
      ok: true,
      meta: { backfilled: true, source: 'yahoo' },
    });
  }
  return out;
}
