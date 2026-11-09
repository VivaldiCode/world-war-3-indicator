import type { DataSource } from '../types';
import { fetchJson } from '../http';
import { piecewise, reading } from '../scoring';

/**
 * IMF PortWatch daily transit counts at maritime chokepoints (ArcGIS, no key).
 * A physical signal: a closing or harassed strait shows up as missing ships.
 * PortWatch publishes weekly, so the newest day is ~1 week old.
 */
export const CHOKEPOINTS = [
  { name: 'Strait of Hormuz', weight: 3 },
  { name: 'Taiwan Strait', weight: 3 },
  { name: 'Bab el-Mandeb Strait', weight: 2 },
  { name: 'Bosporus Strait', weight: 1 },
  { name: 'Suez Canal', weight: 1 },
] as const;

const ENDPOINT =
  'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query';

interface ArcGis {
  features?: Array<{ attributes: { date: number | string; n_total: number | null } }>;
  error?: { message?: string };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** `daily` is newest first. Score = half "dropped vs the previous 90 days", half "below the 1-year median". */
export function chokepointScore(daily: number[]): { score: number; last7: number; prev90: number; yearMedian: number; dropRecentPct: number; dropLevelPct: number } {
  const last7 = mean(daily.slice(0, 7));
  const prev90 = mean(daily.slice(7, 97));
  const yearMedian = median(daily.slice(7));
  const dropRecentPct = prev90 > 0 ? Math.max(0, (1 - last7 / prev90) * 100) : 0;
  const dropLevelPct = yearMedian > 0 ? Math.max(0, (1 - last7 / yearMedian) * 100) : 0;
  const recent = piecewise(dropRecentPct, [[0, 10], [15, 40], [30, 70], [50, 100]]);
  const level = piecewise(dropLevelPct, [[0, 10], [15, 40], [30, 70], [50, 100]]);
  return { score: 0.5 * recent + 0.5 * level, last7, prev90, yearMedian, dropRecentPct, dropLevelPct };
}

async function daily(name: string): Promise<number[]> {
  const q = new URLSearchParams({
    where: `portname='${name}'`,
    outFields: 'date,n_total',
    orderByFields: 'date DESC',
    resultRecordCount: '400',
    returnGeometry: 'false',
    f: 'json',
  });
  const json = await fetchJson<ArcGis>(`${ENDPOINT}?${q}`);
  if (json.error) throw new Error(`PortWatch error for ${name}: ${json.error.message ?? 'unknown'}`);
  const rows = json.features ?? [];
  if (rows.length < 30) throw new Error(`PortWatch returned only ${rows.length} days for ${name}`);
  return rows.map((f) => Number(f.attributes.n_total ?? 0));
}

export const portwatchSource: DataSource = {
  id: 'portwatch-chokepoints',
  name: 'IMF PortWatch — Chokepoint Traffic',
  description:
    'Daily ship transits through Hormuz, Taiwan Strait, Bab el-Mandeb, Bosporus and Suez, against their own recent and 1-year baselines. Published weekly (about 1 week behind).',
  provider: 'IMF PortWatch',
  providerUrl: 'https://portwatch.imf.org/',
  category: 'military',
  weight: 5,
  refreshIntervalSec: 6 * 3600,
  unit: 'score',
  scoringExplanation:
    'Per chokepoint: 7-day mean vs the previous 90 days and vs the 1-year median (50 % drop → 100); weighted Hormuz 3, Taiwan 3, Bab el-Mandeb 2, Bosporus 1, Suez 1.',
  async fetch() {
    const parts = await Promise.all(CHOKEPOINTS.map(async (c) => ({ c, r: chokepointScore(await daily(c.name)) })));
    const total = CHOKEPOINTS.reduce((s, c) => s + c.weight, 0);
    const score = parts.reduce((s, p) => s + p.c.weight * p.r.score, 0) / total;
    const worst = [...parts].sort((a, b) => b.r.score - a.r.score)[0];
    return reading({
      sourceId: portwatchSource.id,
      raw: Number(score.toFixed(1)),
      rawUnit: 'score',
      score,
      rationale: `Chokepoint traffic stress ${score.toFixed(0)}/100; most stressed: ${worst.c.name} (7d ${worst.r.last7.toFixed(1)}/day, ${worst.r.dropRecentPct.toFixed(0)}% below the previous 90 d, ${worst.r.dropLevelPct.toFixed(0)}% below the 1-year median).`,
      meta: Object.fromEntries(parts.map((p) => [p.c.name, { last7: p.r.last7, prev90: p.r.prev90, yearMedian: p.r.yearMedian, score: p.r.score }])),
    });
  },
};
