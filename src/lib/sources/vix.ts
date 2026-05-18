import type { DataSource } from '../types';
import { fetchYahoo } from '../http';
import { piecewise, reading } from '../scoring';
import { yahooBackfill } from './_yahoo_backfill';

export const vixSource: DataSource = {
  id: 'vix',
  name: 'VIX — Equity Fear Index',
  description:
    "CBOE Volatility Index, the market's 30-day expectation of S&P 500 volatility. Spikes above 30 mean the market is pricing in real fear.",
  provider: 'Yahoo Finance',
  providerUrl: 'https://finance.yahoo.com/quote/%5EVIX',
  category: 'markets',
  weight: 7,
  refreshIntervalSec: 60 * 30,
  unit: 'index',
  scoringExplanation:
    'Pure level-based mapping: <15 calm, 25 elevated, 35 fear, 50+ panic.',
  async fetch() {
    const q = await fetchYahoo('^VIX');
    const score = piecewise(q.close, [
      [10, 0],
      [18, 25],
      [25, 50],
      [35, 75],
      [50, 100],
    ]);
    return reading({
      sourceId: vixSource.id,
      raw: q.close,
      rawUnit: 'index',
      score,
      rationale: `VIX at ${q.close.toFixed(2)} — ${q.close < 18 ? 'calm' : q.close < 25 ? 'elevated' : q.close < 35 ? 'fearful' : 'panic'} regime.`,
      meta: { prevClose: q.prevClose, monthAgoClose: q.monthAgoClose, date: q.date },
    });
  },
  backfill(opts) {
    return yahooBackfill(
      {
        sourceId: vixSource.id,
        symbol: '^VIX',
        rawUnit: 'index',
        // stride: Yahoo already downsamples range=max to monthly cadence
        scoreFor(close) {
          const score = piecewise(close, [
            [10, 0],
            [18, 25],
            [25, 50],
            [35, 75],
            [50, 100],
          ]);
          return {
            score,
            rationale: `VIX ${close.toFixed(2)} (historical).`,
          };
        },
      },
      opts,
    );
  },
};
