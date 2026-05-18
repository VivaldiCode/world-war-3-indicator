import type { DataSource } from '../types';
import { fetchYahoo } from '../http';
import { piecewise, reading } from '../scoring';
import { yahooBackfill } from './_yahoo_backfill';

export const oilSource: DataSource = {
  id: 'oil-brent',
  name: 'Brent Crude',
  description:
    'Brent crude front-month futures (USD/bbl). Carries a heavy geopolitical premium when Middle-East, Russia, or shipping-lane risks escalate.',
  provider: 'Yahoo Finance',
  providerUrl: 'https://finance.yahoo.com/quote/BZ=F',
  category: 'markets',
  weight: 9,
  refreshIntervalSec: 60 * 60,
  unit: 'USD/bbl',
  scoringExplanation:
    'Score blends absolute level (panic above $110/bbl) with 30-day momentum. Spikes >$20 in a month historically signal acute conflict risk.',
  async fetch() {
    const q = await fetchYahoo('BZ=F');
    const level = piecewise(q.close, [
      [40, 0],
      [70, 25],
      [90, 50],
      [110, 75],
      [140, 100],
    ]);
    const momentum = q.monthAgoClose
      ? piecewise(((q.close - q.monthAgoClose) / q.monthAgoClose) * 100, [
          [-15, 0],
          [0, 25],
          [10, 50],
          [20, 80],
          [35, 100],
        ])
      : 50;
    const score = 0.6 * level + 0.4 * momentum;
    const pctMo = q.monthAgoClose
      ? (((q.close - q.monthAgoClose) / q.monthAgoClose) * 100).toFixed(1)
      : 'n/a';
    return reading({
      sourceId: oilSource.id,
      raw: q.close,
      rawUnit: 'USD/bbl',
      score,
      rationale: `Brent at $${q.close.toFixed(2)} (${pctMo}% 30d). Level→${level.toFixed(0)}, momentum→${momentum.toFixed(0)}.`,
      meta: { prevClose: q.prevClose, monthAgoClose: q.monthAgoClose, date: q.date },
    });
  },
  backfill(opts) {
    return yahooBackfill(
      {
        sourceId: oilSource.id,
        symbol: 'BZ=F',
        rawUnit: 'USD/bbl',
        // stride: Yahoo already downsamples range=max to monthly cadence
        scoreFor(close, monthAgo) {
          const level = piecewise(close, [
            [40, 0],
            [70, 25],
            [90, 50],
            [110, 75],
            [140, 100],
          ]);
          const mom = monthAgo
            ? piecewise(((close - monthAgo) / monthAgo) * 100, [
                [-15, 0],
                [0, 25],
                [10, 50],
                [20, 80],
                [35, 100],
              ])
            : 50;
          const pctMo = monthAgo ? (((close - monthAgo) / monthAgo) * 100).toFixed(1) : 'n/a';
          return {
            score: 0.6 * level + 0.4 * mom,
            rationale: `Brent $${close.toFixed(2)} (${pctMo}% 30d historical).`,
          };
        },
      },
      opts,
    );
  },
};
