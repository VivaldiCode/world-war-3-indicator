import type { DataSource } from '../types';
import { fetchYahoo } from '../http';
import { piecewise, reading } from '../scoring';

/** Pure scoring, exported for tests: drawdown from the 2-month high + 1-month change. */
export function taiexScore(close: number, periodHigh: number, monthAgoClose?: number) {
  const drawdownPct = periodHigh > 0 ? Math.max(0, ((periodHigh - close) / periodHigh) * 100) : 0;
  const drawdown = piecewise(drawdownPct, [
    [0, 10],
    [5, 30],
    [10, 50],
    [20, 75],
    [35, 100],
  ]);
  const changePct = monthAgoClose ? ((close - monthAgoClose) / monthAgoClose) * 100 : 0;
  const momentum = piecewise(changePct, [
    [-20, 100],
    [-10, 75],
    [-3, 50],
    [0, 25],
    [5, 10],
  ]);
  return { score: 0.6 * drawdown + 0.4 * momentum, drawdownPct, changePct, drawdown, momentum };
}

export const taiexSource: DataSource = {
  id: 'taiex',
  name: 'TAIEX — Taiwan Equity Stress',
  description:
    'Taiwan Stock Exchange index. A sharp drawdown is a market read on Taiwan Strait risk (and on the chip supply chain).',
  provider: 'Yahoo Finance',
  providerUrl: 'https://finance.yahoo.com/quote/%5ETWII',
  category: 'markets',
  weight: 4,
  refreshIntervalSec: 60 * 60,
  unit: 'TWD',
  scoringExplanation:
    '60% drawdown from the 2-month high (10% down → 50, 20% → 75, 35% → 100) and 40% one-month change (−10% → 75, flat → 25).',
  async fetch() {
    const q = await fetchYahoo('^TWII');
    const r = taiexScore(q.close, q.periodHigh ?? q.close, q.monthAgoClose);
    return reading({
      sourceId: taiexSource.id,
      raw: q.close,
      rawUnit: 'TWD',
      score: r.score,
      rationale: `TAIEX at ${q.close.toFixed(0)}: ${r.drawdownPct.toFixed(1)}% below its 2-month high, ${r.changePct.toFixed(1)}% over 30d. Drawdown→${r.drawdown.toFixed(0)}, momentum→${r.momentum.toFixed(0)}.`,
      meta: { periodHigh: q.periodHigh, monthAgoClose: q.monthAgoClose, date: q.date },
    });
  },
};
