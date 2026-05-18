import type { DataSource, SourceReading } from '../types';
import { fetchText } from '../http';
import { bandFor, clamp, piecewise, reading } from '../scoring';
import { SIPRI_WORLD_MIL_SPEND_TRILLIONS } from '@/data/historical_annual';

/**
 * SIPRI — Stockholm International Peace Research Institute. Annual military
 * expenditure release (typically every April). We pin the latest known
 * headline number and best-effort try to upgrade it via the SIPRI press-
 * release page or Wikipedia.
 */
export const sipriMilitarySpendSource: DataSource = {
  id: 'sipri-mil-spend',
  name: 'SIPRI — Global Military Spending',
  description:
    'Total global military expenditure (USD trillions, latest SIPRI release). Sustained growth signals structural re-armament.',
  provider: 'SIPRI',
  providerUrl: 'https://www.sipri.org/research/armament-and-disarmament/arms-and-military-expenditure',
  category: 'military',
  weight: 5,
  refreshIntervalSec: 60 * 60 * 24 * 30,
  unit: 'USD trillions',
  scoringExplanation:
    '2.0T baseline → 30. 2.4T → 60. 3.0T+ → red. Refreshes annually with the SIPRI fact sheet.',
  async fetch() {
    // Latest known published SIPRI figure (2024 spending, released April 2025).
    let trill = 2.718;
    let year = 2024;
    let provenance: 'pinned' | 'sipri' | 'wikipedia' = 'pinned';
    const candidates: Array<{ url: string; tag: 'sipri' | 'wikipedia' }> = [
      { url: 'https://www.sipri.org/media/press-release', tag: 'sipri' },
      {
        url: 'https://en.wikipedia.org/wiki/List_of_countries_by_military_expenditures',
        tag: 'wikipedia',
      },
    ];
    for (const c of candidates) {
      try {
        const html = await fetchText(c.url);
        // Match patterns like "$2.7 trillion" or "US$2,718 billion"
        const trillionMatch = html.match(/\$?\s?(\d\.\d{1,3})\s?trillion/i);
        const billionMatch = html.match(/\$?\s?(\d{4})\s?billion/);
        const yearMatch = html.match(/(?:in|for|during)\s+(20[2-9][0-9])/);
        let value: number | null = null;
        if (trillionMatch) value = Number(trillionMatch[1]);
        else if (billionMatch) value = Number(billionMatch[1]) / 1000;
        if (value && value >= 1.5 && value <= 5) {
          trill = value;
          if (yearMatch) year = Number(yearMatch[1]);
          provenance = c.tag;
          break;
        }
      } catch {
        // continue to next candidate
      }
    }
    const score = piecewise(trill, [
      [1.6, 0],
      [2.0, 30],
      [2.4, 60],
      [2.8, 80],
      [3.2, 100],
    ]);
    return reading({
      sourceId: sipriMilitarySpendSource.id,
      raw: trill,
      rawUnit: 'USD trillions',
      score,
      rationale: `Global military spend ${year} ≈ $${trill.toFixed(2)}T (${provenance}).`,
      meta: { year, provenance },
    });
  },
  async backfill(opts) {
    const fromMs = opts.from ? Date.parse(opts.from) : -Infinity;
    const toMs = opts.to ? Date.parse(opts.to) : Date.now();
    const out: SourceReading[] = [];
    for (const { year, value } of SIPRI_WORLD_MIL_SPEND_TRILLIONS) {
      // Anchor each annual data point on Dec 31 of its calendar year.
      const ts = Date.UTC(year, 11, 31);
      if (ts < fromMs || ts > toMs) continue;
      const score = clamp(piecewise(value, [
        [1.6, 0],
        [2.0, 30],
        [2.4, 60],
        [2.8, 80],
        [3.2, 100],
      ]));
      out.push({
        sourceId: sipriMilitarySpendSource.id,
        measuredAt: new Date(ts).toISOString(),
        raw: value,
        rawUnit: 'USD trillions',
        score,
        band: bandFor(score),
        rationale: `World military spend ${year} ≈ $${value.toFixed(2)}T (SIPRI historical).`,
        ok: true,
        meta: { year, backfilled: true, source: 'sipri-annual' },
      });
    }
    return out;
  },
};
