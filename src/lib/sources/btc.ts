import type { DataSource } from '../types';
import { fetchYahoo } from '../http';
import { piecewise, reading } from '../scoring';
import { yahooBackfill } from './_yahoo_backfill';

export const btcSource: DataSource = {
  id: 'bitcoin',
  name: 'Bitcoin (BTC/USD)',
  description:
    'Bitcoin spot price. Behaves inconsistently as a safe-haven, but extreme drawdowns often coincide with broader risk-off liquidations.',
  provider: 'Yahoo Finance',
  providerUrl: 'https://finance.yahoo.com/quote/BTC-USD',
  category: 'markets',
  weight: 3,
  refreshIntervalSec: 60 * 30,
  unit: 'USD',
  scoringExplanation:
    'Score driven by 30-day drawdown only — a >25% one-month drop is a clear global risk-off tell. Rallies are not penalized.',
  async fetch() {
    const q = await fetchYahoo('BTC-USD');
    const pct = q.monthAgoClose ? ((q.close - q.monthAgoClose) / q.monthAgoClose) * 100 : 0;
    const score = piecewise(pct, [
      [-40, 100],
      [-25, 75],
      [-10, 50],
      [0, 25],
      [10, 0],
    ]);
    return reading({
      sourceId: btcSource.id,
      raw: q.close,
      rawUnit: 'USD',
      score,
      rationale: `BTC at $${q.close.toFixed(0)} (${pct.toFixed(1)}% 30d). Drawdown→risk-off bid.`,
      meta: { prevClose: q.prevClose, monthAgoClose: q.monthAgoClose, date: q.date },
    });
  },
  backfill(opts) {
    return yahooBackfill(
      {
        sourceId: btcSource.id,
        symbol: 'BTC-USD',
        rawUnit: 'USD',
        // BTC only really exists post-2014.
        earliestUsable: '2014-09-17T00:00:00.000Z',
        scoreFor(close, monthAgo) {
          const pct = monthAgo ? ((close - monthAgo) / monthAgo) * 100 : 0;
          const score = piecewise(pct, [
            [-40, 100],
            [-25, 75],
            [-10, 50],
            [0, 25],
            [10, 0],
          ]);
          return {
            score,
            rationale: `BTC $${close.toFixed(0)} (${pct.toFixed(1)}% 30d historical).`,
          };
        },
      },
      opts,
    );
  },
};
