export type SeverityBand = 'green' | 'yellow' | 'red';

export type SourceCategory =
  | 'markets'      // commodities, currencies, equities, rates
  | 'conflicts'    // armed conflict counts/intensities
  | 'sentiment'    // news tone, social signals
  | 'military'     // hard-power rankings, military spend
  | 'diplomacy';   // sanctions, treaty exits, etc.

/**
 * Normalized contribution of a source to the WW3 index.
 *  - `score` is 0..100 where 0 = peaceful, 100 = on-the-brink.
 *  - `raw` is the original measured value (e.g., gold price in USD/oz).
 *  - `band` is the green/yellow/red colour from the Risk-style mapping.
 */
export interface SourceReading {
  sourceId: string;
  score: number;
  raw: number | string | null;
  rawUnit?: string;
  band: SeverityBand;
  rationale: string;
  measuredAt: string; // ISO timestamp
  ok: boolean;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface DataSource {
  /** Stable kebab-case id used as primary key. */
  id: string;
  /** Display name for the UI card / API. */
  name: string;
  /** Short human description, ~120 chars. */
  description: string;
  /** Where the data is pulled from (vendor / URL). */
  provider: string;
  providerUrl: string;
  category: SourceCategory;
  /**
   * Relative weight in the final composite. Heavier topics (gold/oil/conflicts)
   * should be higher. The engine renormalizes weights to sum to 1.
   */
  weight: number;
  /** How often the source should be refreshed, in seconds. */
  refreshIntervalSec: number;
  /** Human-readable unit, e.g. "USD/oz". */
  unit?: string;
  /** Plain-language explanation of how the score is derived. */
  scoringExplanation: string;
  fetch(): Promise<SourceReading>;
  /**
   * Optional one-shot historical backfill. When implemented, returns the
   * widest possible time series the publisher exposes (ideally back to the
   * end of WW2 on 1945-09-02 — most publishers only have a fraction of that).
   * The returned readings carry their real historical `measuredAt` so they
   * can be inserted into the time-series store.
   *
   * The caller is expected to be the offline `scripts/backfill.ts` CLI; we
   * do not invoke this from the live request path.
   */
  backfill?: (opts: { from?: string; to?: string }) => Promise<SourceReading[]>;
}

export interface CompositeIndex {
  score: number;            // 0..100 weighted composite
  band: SeverityBand;
  computedAt: string;
  contributors: Array<{
    sourceId: string;
    name: string;
    category: SourceCategory;
    weight: number;          // normalized weight 0..1
    score: number;           // 0..100
    band: SeverityBand;
    contribution: number;    // weight * score (so contributions sum to `score`)
    raw: number | string | null;
    rawUnit?: string;
    rationale: string;
    measuredAt: string;
    ok: boolean;
    error?: string;
  }>;
  /** Per-category aggregated score (weighted average within the category). */
  categories: Record<SourceCategory, { score: number; weight: number; band: SeverityBand }>;
}
