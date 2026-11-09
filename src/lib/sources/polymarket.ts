import type { DataSource } from '../types';
import { fetchJson } from '../http';
import { piecewise, reading } from '../scoring';

/**
 * Polymarket crowd probabilities (public gamma API, no key) for a small basket of
 * conflict markets. `risk: 'yes'` = the YES price is the danger (an invasion);
 * `risk: 'no'` = the NO price is the danger (a ceasefire that must hold).
 * Override the basket with WW3_POLYMARKET_BASKET = "slug:yes:3,slug:no:2,...".
 */
export interface BasketItem {
  slug: string;
  risk: 'yes' | 'no';
  weight: number;
}

export const DEFAULT_BASKET: BasketItem[] = [
  { slug: 'will-the-us-invade-iran-before-2027', risk: 'yes', weight: 3 },
  { slug: 'will-china-invade-taiwan-before-2027', risk: 'yes', weight: 3 },
  { slug: 'israel-x-iran-ceasefire-continues-through-december-31-415', risk: 'no', weight: 2 },
];

export function parseBasket(env: string | undefined): BasketItem[] {
  if (!env) return DEFAULT_BASKET;
  const items = env.split(',').map((part) => {
    const [slug, risk, weight] = part.trim().split(':');
    if (!slug || (risk !== 'yes' && risk !== 'no')) throw new Error(`bad WW3_POLYMARKET_BASKET entry: ${part}`);
    return { slug, risk, weight: Number(weight ?? 1) } as BasketItem;
  });
  return items.length ? items : DEFAULT_BASKET;
}

interface GammaMarket {
  slug: string;
  question: string;
  closed?: boolean;
  active?: boolean;
  liquidity?: string | number;
  outcomePrices?: string;
}

/** Probability of the dangerous outcome, 0..1. */
export function riskProbability(m: GammaMarket, risk: 'yes' | 'no'): number {
  const prices = JSON.parse(m.outcomePrices ?? '[]') as string[];
  const yes = Number(prices[0]);
  if (!Number.isFinite(yes)) throw new Error(`no price for ${m.slug}`);
  return risk === 'yes' ? yes : 1 - yes;
}

/** Score a probability: a year-end invasion at 15 % is already alarming, a ceasefire at 50 % is a coin toss. */
export function scoreProbability(p: number, risk: 'yes' | 'no'): number {
  return risk === 'yes'
    ? piecewise(p, [[0, 0], [0.05, 20], [0.15, 50], [0.35, 80], [0.6, 100]])
    : piecewise(p, [[0, 0], [0.1, 25], [0.25, 50], [0.5, 80], [0.8, 100]]);
}

export const polymarketSource: DataSource = {
  id: 'polymarket-conflict',
  name: 'Polymarket — Conflict Odds',
  description:
    'Crowd-priced probabilities of a US–Iran war, a China–Taiwan invasion and the Israel–Iran ceasefire failing, from Polymarket.',
  provider: 'Polymarket (gamma API)',
  providerUrl: 'https://polymarket.com/',
  category: 'diplomacy',
  weight: 6,
  refreshIntervalSec: 60 * 60,
  unit: 'score',
  scoringExplanation:
    'Weighted mean of per-market scores: invasion markets 5 % → 20, 15 % → 50, 35 % → 80; ceasefire-failure 25 % → 50, 50 % → 80. Closed, resolved or thin (< 20k liquidity) markets are skipped; fewer than 2 live markets is an error.',
  async fetch() {
    const basket = parseBasket(process.env.WW3_POLYMARKET_BASKET);
    const results = await Promise.all(
      basket.map(async (b) => {
        try {
          const arr = await fetchJson<GammaMarket[]>(`https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(b.slug)}`);
          const m = arr[0];
          if (!m || m.closed || m.active === false) return null;
          if (Number(m.liquidity ?? 0) < 20_000) return null;
          const p = riskProbability(m, b.risk);
          return { b, m, p, score: scoreProbability(p, b.risk) };
        } catch {
          return null;
        }
      }),
    );
    const live = results.filter((r): r is NonNullable<typeof r> => r !== null);
    if (live.length < 2) throw new Error(`Polymarket: only ${live.length} live market(s) of ${basket.length}`);
    const total = live.reduce((s, r) => s + r.b.weight, 0);
    const score = live.reduce((s, r) => s + r.b.weight * r.score, 0) / total;
    return reading({
      sourceId: polymarketSource.id,
      raw: Number(score.toFixed(1)),
      rawUnit: 'score',
      score,
      rationale: `Conflict odds → ${score.toFixed(0)}/100: ${live.map((r) => `${r.m.question.slice(0, 50)} ${(r.p * 100).toFixed(1)}%`).join('; ')}.`,
      meta: { markets: live.map((r) => ({ slug: r.b.slug, risk: r.b.risk, p: r.p, score: r.score })) },
    });
  },
};
