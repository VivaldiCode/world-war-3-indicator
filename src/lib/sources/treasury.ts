import type { DataSource } from '../types';
import { fetchYahoo } from '../http';
import { piecewise, reading } from '../scoring';
import { yahooBackfill } from './_yahoo_backfill';

export const treasury10ySource: DataSource = {
  id: 'us10y-yield',
  name: 'US 10-Year Yield',
  description:
    'Yield on the US 10-year Treasury (%). A sharp drop signals global flight-to-quality; sudden spikes can mean dollar-system stress.',
  provider: 'Yahoo Finance',
  providerUrl: 'https://finance.yahoo.com/quote/%5ETNX',
  category: 'markets',
  weight: 4,
  refreshIntervalSec: 60 * 60,
  unit: '%',
  scoringExplanation:
    'Score is driven by 30-day move magnitude in either direction — both crashes and spikes signal stress. A ≥60bp move in 30d → red.',
  async fetch() {
    // Yahoo reports ^TNX in percent (e.g. 4.25). Past versions reported it
    // in tenths-of-percent — defensively normalise if we ever see a value > 25.
    const q = await fetchYahoo('^TNX');
    const scale = (n: number) => (n > 25 ? n / 10 : n);
    const close = scale(q.close);
    const monthAgo = q.monthAgoClose ? scale(q.monthAgoClose) : undefined;
    const moveBp = monthAgo ? Math.abs(close - monthAgo) * 100 : 0;
    const score = piecewise(moveBp, [
      [0, 10],
      [15, 30],
      [30, 55],
      [60, 80],
      [100, 100],
    ]);
    return reading({
      sourceId: treasury10ySource.id,
      raw: close,
      rawUnit: '%',
      score,
      rationale: `US10Y at ${close.toFixed(2)}% (Δ ${moveBp.toFixed(0)}bp over 30d).`,
      meta: { prevClose: q.prevClose, monthAgoClose: monthAgo, date: q.date },
    });
  },
  backfill(opts) {
    return yahooBackfill(
      {
        sourceId: treasury10ySource.id,
        symbol: '^TNX',
        rawUnit: '%',
        // stride: Yahoo already downsamples range=max to monthly cadence
        scoreFor(close, monthAgo) {
          const scale = (n: number) => (n > 25 ? n / 10 : n);
          const c = scale(close);
          const m = monthAgo ? scale(monthAgo) : undefined;
          const moveBp = m ? Math.abs(c - m) * 100 : 0;
          const score = piecewise(moveBp, [
            [0, 10],
            [15, 30],
            [30, 55],
            [60, 80],
            [100, 100],
          ]);
          return {
            score,
            rationale: `US10Y ${c.toFixed(2)}% (Δ ${moveBp.toFixed(0)}bp 30d historical).`,
          };
        },
      },
      opts,
    );
  },
};
