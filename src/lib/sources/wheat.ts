import type { DataSource } from '../types';
import { fetchYahoo } from '../http';
import { piecewise, reading } from '../scoring';
import { yahooBackfill } from './_yahoo_backfill';

export const wheatSource: DataSource = {
  id: 'wheat-futures',
  name: 'Wheat Futures',
  description:
    'CBOT wheat front-month (USc/bushel). Food-security shocks — especially around the Black Sea — translate fast into geopolitical instability.',
  provider: 'Yahoo Finance',
  providerUrl: 'https://finance.yahoo.com/quote/ZW=F',
  category: 'markets',
  weight: 5,
  refreshIntervalSec: 60 * 60 * 2,
  unit: 'USc/bu',
  scoringExplanation:
    'Blends absolute level and 30-day momentum. Wheat above 900¢/bu or +25% in a month is a strong food-security alarm.',
  async fetch() {
    const q = await fetchYahoo('ZW=F');
    const level = piecewise(q.close, [
      [400, 0],
      [600, 25],
      [800, 50],
      [1000, 75],
      [1400, 100],
    ]);
    const momentum = q.monthAgoClose
      ? piecewise(((q.close - q.monthAgoClose) / q.monthAgoClose) * 100, [
          [-15, 0],
          [0, 25],
          [10, 50],
          [25, 80],
          [50, 100],
        ])
      : 50;
    const score = 0.5 * level + 0.5 * momentum;
    const pctMo = q.monthAgoClose
      ? (((q.close - q.monthAgoClose) / q.monthAgoClose) * 100).toFixed(1)
      : 'n/a';
    return reading({
      sourceId: wheatSource.id,
      raw: q.close,
      rawUnit: 'USc/bu',
      score,
      rationale: `Wheat at ${q.close.toFixed(0)}¢/bu (${pctMo}% 30d). Level→${level.toFixed(0)}, momentum→${momentum.toFixed(0)}.`,
      meta: { prevClose: q.prevClose, monthAgoClose: q.monthAgoClose, date: q.date },
    });
  },
  backfill(opts) {
    return yahooBackfill(
      {
        sourceId: wheatSource.id,
        symbol: 'ZW=F',
        rawUnit: 'USc/bu',
        // stride: Yahoo already downsamples range=max to monthly cadence
        scoreFor(close, monthAgo) {
          const level = piecewise(close, [
            [400, 0],
            [600, 25],
            [800, 50],
            [1000, 75],
            [1400, 100],
          ]);
          const mom = monthAgo
            ? piecewise(((close - monthAgo) / monthAgo) * 100, [
                [-15, 0],
                [0, 25],
                [10, 50],
                [25, 80],
                [50, 100],
              ])
            : 50;
          const pctMo = monthAgo ? (((close - monthAgo) / monthAgo) * 100).toFixed(1) : 'n/a';
          return {
            score: 0.5 * level + 0.5 * mom,
            rationale: `Wheat ${close.toFixed(0)}¢/bu (${pctMo}% 30d historical).`,
          };
        },
      },
      opts,
    );
  },
};
