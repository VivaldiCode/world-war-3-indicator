import type { DataSource, SourceReading } from '../types';
import { fetchText } from '../http';
import { bandFor, clamp, piecewise, reading } from '../scoring';
import * as cheerio from 'cheerio';
import { GFP_TOP10_POWERINDEX } from '@/data/historical_annual';

/**
 * GlobalFirepower.com publishes an annual "PowerIndex" ranking of military
 * strength. The site explicitly says lower index = stronger. We pull the top
 * 10 entries from the ranking page and aggregate their PowerIndex values into
 * a "global mil concentration" signal — the lower the top-10 average, the
 * more military power is concentrated and primed.
 *
 * NOTE: Scraping respects their public ranking page only.
 */
export const globalFirepowerSource: DataSource = {
  id: 'globalfirepower-top10',
  name: 'GlobalFirepower — Top-10 Power Concentration',
  description:
    'Average PowerIndex of the top-10 military powers (lower = stronger). Tracks how primed the world\'s heaviest militaries are. Refreshes annually.',
  provider: 'GlobalFirepower.com',
  providerUrl: 'https://www.globalfirepower.com/countries-listing.php',
  category: 'military',
  weight: 6,
  refreshIntervalSec: 60 * 60 * 24 * 7, // weekly check
  unit: 'PowerIndex avg',
  scoringExplanation:
    'Lower avg PowerIndex of top 10 → red. 0.10 average is historically tense; 0.20 is calmer baseline.',
  async fetch() {
    const html = await fetchText('https://www.globalfirepower.com/countries-listing.php');
    const $ = cheerio.load(html);
    const indices: number[] = [];
    // The page renders ranking tiles with a `.pInd` (PowerIndex) span.
    $('.specs-strength-power-index, .pInd, span:contains("PwrIndx")').each((_, el) => {
      const txt = $(el).text();
      const m = txt.match(/(\d\.\d{3,5})/);
      if (m) indices.push(Number(m[1]));
    });
    // Fallback: walk all text and pick numbers between 0.00 and 0.50 (PowerIndex range)
    if (indices.length < 10) {
      const all = html.match(/0\.\d{3,5}/g) ?? [];
      for (const s of all) {
        const n = Number(s);
        if (n > 0 && n < 0.5) indices.push(n);
        if (indices.length >= 30) break;
      }
    }
    if (indices.length < 5) {
      throw new Error('Could not extract enough PowerIndex values from GlobalFirepower');
    }
    indices.sort((a, b) => a - b);
    const top10 = indices.slice(0, 10);
    const avg = top10.reduce((s, n) => s + n, 0) / top10.length;
    const score = piecewise(avg, [
      [0.05, 100],
      [0.10, 80],
      [0.15, 55],
      [0.20, 35],
      [0.30, 10],
    ]);
    return reading({
      sourceId: globalFirepowerSource.id,
      raw: Number(avg.toFixed(4)),
      rawUnit: 'PowerIndex avg',
      score,
      rationale: `Top-10 GFP PowerIndex avg = ${avg.toFixed(4)}. Lower = more concentrated military power.`,
      meta: { top10 },
    });
  },
  async backfill(opts) {
    const fromMs = opts.from ? Date.parse(opts.from) : -Infinity;
    const toMs = opts.to ? Date.parse(opts.to) : Date.now();
    const out: SourceReading[] = [];
    for (const { year, value } of GFP_TOP10_POWERINDEX) {
      // GFP refreshes early each calendar year — anchor on Jan 31.
      const ts = Date.UTC(year, 0, 31);
      if (ts < fromMs || ts > toMs) continue;
      const score = clamp(piecewise(value, [
        [0.05, 100],
        [0.10, 80],
        [0.15, 55],
        [0.20, 35],
        [0.30, 10],
      ]));
      out.push({
        sourceId: globalFirepowerSource.id,
        measuredAt: new Date(ts).toISOString(),
        raw: value,
        rawUnit: 'PowerIndex avg',
        score,
        band: bandFor(score),
        rationale: `GFP top-10 PowerIndex avg ${value.toFixed(4)} (${year}).`,
        ok: true,
        meta: { edition: year, backfilled: true, source: 'gfp-annual' },
      });
    }
    return out;
  },
};
