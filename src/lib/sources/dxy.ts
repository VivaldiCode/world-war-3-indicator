import type { DataSource } from '../types';
import { fetchYahoo } from '../http';
import { piecewise, reading } from '../scoring';
import { yahooBackfill } from './_yahoo_backfill';

export const dxySource: DataSource = {
  id: 'usd-index',
  name: 'US Dollar Index (DXY)',
  description:
    'Trade-weighted index of USD vs. a basket of major currencies. Sharp DXY spikes typically reflect a global flight-to-safety bid for dollars.',
  provider: 'Yahoo Finance',
  providerUrl: 'https://finance.yahoo.com/quote/DX-Y.NYB',
  category: 'markets',
  weight: 5,
  refreshIntervalSec: 60 * 60,
  unit: 'index',
  scoringExplanation:
    'Mostly driven by 30-day momentum — a >3% rip in a month is a tell-tale risk-off shock. Absolute level above 110 adds extra stress.',
  async fetch() {
    const q = await fetchYahoo('DX-Y.NYB');
    const level = piecewise(q.close, [
      [90, 0],
      [100, 30],
      [105, 50],
      [110, 75],
      [120, 100],
    ]);
    const momentum = q.monthAgoClose
      ? piecewise(((q.close - q.monthAgoClose) / q.monthAgoClose) * 100, [
          [-5, 0],
          [0, 30],
          [2, 55],
          [4, 80],
          [8, 100],
        ])
      : 50;
    const score = 0.4 * level + 0.6 * momentum;
    const pctMo = q.monthAgoClose
      ? (((q.close - q.monthAgoClose) / q.monthAgoClose) * 100).toFixed(1)
      : 'n/a';
    return reading({
      sourceId: dxySource.id,
      raw: q.close,
      rawUnit: 'index',
      score,
      rationale: `DXY at ${q.close.toFixed(2)} (${pctMo}% 30d). Level→${level.toFixed(0)}, momentum→${momentum.toFixed(0)}.`,
      meta: { prevClose: q.prevClose, monthAgoClose: q.monthAgoClose, date: q.date },
    });
  },
  backfill(opts) {
    return yahooBackfill(
      {
        sourceId: dxySource.id,
        symbol: 'DX-Y.NYB',
        rawUnit: 'index',
        // stride: Yahoo already downsamples range=max to monthly cadence
        scoreFor(close, monthAgo) {
          const level = piecewise(close, [
            [90, 0],
            [100, 30],
            [105, 50],
            [110, 75],
            [120, 100],
          ]);
          const mom = monthAgo
            ? piecewise(((close - monthAgo) / monthAgo) * 100, [
                [-5, 0],
                [0, 30],
                [2, 55],
                [4, 80],
                [8, 100],
              ])
            : 50;
          const pctMo = monthAgo ? (((close - monthAgo) / monthAgo) * 100).toFixed(1) : 'n/a';
          return {
            score: 0.4 * level + 0.6 * mom,
            rationale: `DXY ${close.toFixed(2)} (${pctMo}% 30d historical).`,
          };
        },
      },
      opts,
    );
  },
};
