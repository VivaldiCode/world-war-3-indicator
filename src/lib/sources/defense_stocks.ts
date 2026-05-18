import type { DataSource } from '../types';
import { fetchYahoo } from '../http';
import { piecewise, reading } from '../scoring';
import { yahooBackfill } from './_yahoo_backfill';

export const defenseStocksSource: DataSource = {
  id: 'defense-stocks-ita',
  name: 'Defense Stocks (ITA ETF)',
  description:
    'iShares U.S. Aerospace & Defense ETF (ITA) — a proxy for capital flowing into the global re-armament cycle. Sustained outperformance signals war-economy positioning.',
  provider: 'Yahoo Finance',
  providerUrl: 'https://finance.yahoo.com/quote/ITA',
  category: 'markets',
  weight: 6,
  refreshIntervalSec: 60 * 60 * 2,
  unit: 'USD',
  scoringExplanation:
    'Score blends 30-day momentum (defense bid intensity) and 1-year run (structural re-armament regime). A >10% one-month rip lands deep in red.',
  async fetch() {
    const q = await fetchYahoo('ITA');
    const momentum = q.monthAgoClose
      ? piecewise(((q.close - q.monthAgoClose) / q.monthAgoClose) * 100, [
          [-10, 0],
          [0, 30],
          [4, 55],
          [10, 80],
          [20, 100],
        ])
      : 50;
    const pctMo = q.monthAgoClose
      ? (((q.close - q.monthAgoClose) / q.monthAgoClose) * 100).toFixed(1)
      : 'n/a';
    return reading({
      sourceId: defenseStocksSource.id,
      raw: q.close,
      rawUnit: 'USD',
      score: momentum,
      rationale: `ITA at $${q.close.toFixed(2)} (${pctMo}% 30d). Capital flow into defense names.`,
      meta: { prevClose: q.prevClose, monthAgoClose: q.monthAgoClose, date: q.date },
    });
  },
  backfill(opts) {
    return yahooBackfill(
      {
        sourceId: defenseStocksSource.id,
        symbol: 'ITA',
        rawUnit: 'USD',
        // stride: Yahoo already downsamples range=max to monthly cadence
        earliestUsable: '2006-05-01T00:00:00.000Z',
        scoreFor(close, monthAgo) {
          const momentum = monthAgo
            ? piecewise(((close - monthAgo) / monthAgo) * 100, [
                [-10, 0],
                [0, 30],
                [4, 55],
                [10, 80],
                [20, 100],
              ])
            : 50;
          const pctMo = monthAgo ? (((close - monthAgo) / monthAgo) * 100).toFixed(1) : 'n/a';
          return {
            score: momentum,
            rationale: `ITA $${close.toFixed(2)} (${pctMo}% 30d historical).`,
          };
        },
      },
      opts,
    );
  },
};
