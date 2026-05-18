import type { DataSource, SourceReading } from '../types';
import { bandFor, clamp, piecewise } from '../scoring';
import { UCDP_BATTLE_DEATHS } from '@/data/historical_annual';

/**
 * UCDP / PRIO battle-related deaths — annual world totals.
 *
 * This source is *backfill-only* for now: the live UCDP API gated us out, and
 * Wikipedia's ongoing-conflicts list (handled separately) gives us the live
 * pulse. The seed table here covers 1946 → present so analysts have a deep
 * historical baseline to compare against.
 */
export const ucdpBattleDeathsSource: DataSource = {
  id: 'ucdp-battle-deaths',
  name: 'UCDP / PRIO Battle Deaths (annual)',
  description:
    'World-total combat-related deaths per year from the UCDP / PRIO Battle-Related Deaths Dataset. Long-horizon series (1946 → present) used for temporal analysis.',
  provider: 'UCDP / PRIO',
  providerUrl: 'https://ucdp.uu.se/downloads/',
  category: 'conflicts',
  weight: 4,
  refreshIntervalSec: 60 * 60 * 24 * 30,
  unit: 'deaths/yr',
  scoringExplanation:
    'Score scales with annual battle-deaths. 25k → 30, 80k → 60, 200k+ → red.',
  async fetch() {
    // We don't have a live feed any more; emit the latest published year so
    // the homepage shows a sensible "current state".
    const latest = UCDP_BATTLE_DEATHS[UCDP_BATTLE_DEATHS.length - 1];
    const score = clamp(piecewise(latest.value, [
      [10000, 0],
      [25000, 30],
      [80000, 60],
      [150000, 80],
      [300000, 100],
    ]));
    return {
      sourceId: ucdpBattleDeathsSource.id,
      measuredAt: new Date().toISOString(),
      raw: latest.value,
      rawUnit: 'deaths/yr',
      score,
      band: bandFor(score),
      rationale: `World battle-deaths ${latest.year} ≈ ${latest.value.toLocaleString()} (UCDP/PRIO).`,
      ok: true,
      meta: { year: latest.year, source: 'ucdp-battle-deaths' },
    };
  },
  async backfill(opts) {
    const fromMs = opts.from ? Date.parse(opts.from) : -Infinity;
    const toMs = opts.to ? Date.parse(opts.to) : Date.now();
    const out: SourceReading[] = [];
    for (const { year, value } of UCDP_BATTLE_DEATHS) {
      const ts = Date.UTC(year, 11, 31);
      if (ts < fromMs || ts > toMs) continue;
      const score = clamp(piecewise(value, [
        [10000, 0],
        [25000, 30],
        [80000, 60],
        [150000, 80],
        [300000, 100],
      ]));
      out.push({
        sourceId: ucdpBattleDeathsSource.id,
        measuredAt: new Date(ts).toISOString(),
        raw: value,
        rawUnit: 'deaths/yr',
        score,
        band: bandFor(score),
        rationale: `World battle-deaths ${year} ≈ ${value.toLocaleString()}.`,
        ok: true,
        meta: { year, backfilled: true, source: 'ucdp-prio-annual' },
      });
    }
    return out;
  },
};
