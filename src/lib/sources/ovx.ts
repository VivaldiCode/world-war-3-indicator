import type { DataSource } from '../types';
import { fetchYahoo } from '../http';
import { piecewise, reading } from '../scoring';

export const ovxSource: DataSource = {
  id: 'ovx',
  name: 'OVX — Crude Oil Volatility',
  description:
    'CBOE Crude Oil Volatility Index: the market\'s 30-day expectation of oil-price swings. Jumps when supply routes or producers are threatened.',
  provider: 'Yahoo Finance',
  providerUrl: 'https://finance.yahoo.com/quote/%5EOVX',
  category: 'markets',
  weight: 4,
  refreshIntervalSec: 60 * 30,
  unit: 'index',
  scoringExplanation: 'Level mapping: <30 calm, 45 elevated, 65 stressed, 90+ panic.',
  async fetch() {
    const q = await fetchYahoo('^OVX');
    const score = piecewise(q.close, [
      [20, 0],
      [30, 25],
      [45, 50],
      [65, 75],
      [90, 100],
    ]);
    return reading({
      sourceId: ovxSource.id,
      raw: q.close,
      rawUnit: 'index',
      score,
      rationale: `OVX at ${q.close.toFixed(2)} — ${q.close < 30 ? 'calm' : q.close < 45 ? 'elevated' : q.close < 65 ? 'stressed' : 'panic'} oil-vol regime.`,
      meta: { prevClose: q.prevClose, monthAgoClose: q.monthAgoClose, date: q.date },
    });
  },
};
