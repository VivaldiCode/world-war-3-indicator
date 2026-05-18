import type { DataSource } from '../types';
import { fetchYahoo } from '../http';
import { piecewise, reading } from '../scoring';
import { yahooBackfill } from './_yahoo_backfill';

export const goldSource: DataSource = {
  id: 'gold-spot',
  name: 'Gold (XAU/USD)',
  description:
    'Spot gold price in USD per troy ounce. Classic safe-haven instrument — sustained rallies historically coincide with geopolitical stress and currency-debasement fears.',
  provider: 'Yahoo Finance',
  providerUrl: 'https://finance.yahoo.com/quote/GC=F',
  category: 'markets',
  weight: 9,
  refreshIntervalSec: 60 * 60, // hourly is plenty for daily candles
  unit: 'USD/oz',
  scoringExplanation:
    'Score is a blend of absolute price level (vs. recent regime) and 1-month momentum. Price > $2,800 or +8% in 30d pushes the score into the red band.',
  async fetch() {
    const q = await fetchYahoo('GC=F');
    const level = piecewise(q.close, [
      [2800, 0],
      [3500, 25],
      [4200, 50],
      [5000, 75],
      [6500, 100],
    ]);
    const momentum = q.monthAgoClose
      ? piecewise(((q.close - q.monthAgoClose) / q.monthAgoClose) * 100, [
          [-10, 0],
          [0, 25],
          [3, 50],
          [8, 75],
          [15, 100],
        ])
      : 50;
    const score = 0.65 * level + 0.35 * momentum;
    const pctMo = q.monthAgoClose
      ? (((q.close - q.monthAgoClose) / q.monthAgoClose) * 100).toFixed(1)
      : 'n/a';
    return reading({
      sourceId: goldSource.id,
      raw: q.close,
      rawUnit: 'USD/oz',
      score,
      rationale: `Gold at $${q.close.toFixed(2)} (${pctMo}% 30d). Level→${level.toFixed(0)}, momentum→${momentum.toFixed(0)}.`,
      meta: { prevClose: q.prevClose, monthAgoClose: q.monthAgoClose, date: q.date },
    });
  },
  backfill(opts) {
    return yahooBackfill(
      {
        sourceId: goldSource.id,
        symbol: 'GC=F',
        rawUnit: 'USD/oz',
        // Weekly stride is plenty for a multi-decade level/momentum series.
        // stride: Yahoo already downsamples range=max to monthly cadence
        scoreFor(close, monthAgo) {
          const level = piecewise(close, [
            [2800, 0],
            [3500, 25],
            [4200, 50],
            [5000, 75],
            [6500, 100],
          ]);
          const mom = monthAgo
            ? piecewise(((close - monthAgo) / monthAgo) * 100, [
                [-10, 0],
                [0, 25],
                [3, 50],
                [8, 75],
                [15, 100],
              ])
            : 50;
          const pctMo = monthAgo ? (((close - monthAgo) / monthAgo) * 100).toFixed(1) : 'n/a';
          return {
            score: 0.65 * level + 0.35 * mom,
            rationale: `Gold $${close.toFixed(2)} (${pctMo}% 30d historical).`,
          };
        },
      },
      opts,
    );
  },
};
