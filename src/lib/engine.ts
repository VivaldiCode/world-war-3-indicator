import type { CompositeIndex, DataSource, SourceCategory, SourceReading } from './types';
import { bandFor, errorReading } from './scoring';

/**
 * Compose a weighted composite WW3 index from individual source readings.
 * Weights are renormalized across sources that produced an OK reading so a
 * temporarily failing scraper does not artificially deflate the index.
 */
export function composeIndex(
  sources: DataSource[],
  readings: Record<string, SourceReading>,
): CompositeIndex {
  const okEntries = sources
    .map((s) => ({ source: s, reading: readings[s.id] }))
    .filter((e) => e.reading && e.reading.ok);

  const totalWeight = okEntries.reduce((sum, e) => sum + e.source.weight, 0) || 1;

  const contributors: CompositeIndex['contributors'] = sources.map((s) => {
    const r = readings[s.id];
    const normWeight = r && r.ok ? s.weight / totalWeight : 0;
    const score = r ? r.score : 0;
    return {
      sourceId: s.id,
      name: s.name,
      category: s.category,
      weight: normWeight,
      score,
      band: r ? r.band : 'green',
      contribution: normWeight * score,
      raw: r ? r.raw : null,
      rawUnit: r?.rawUnit,
      rationale: r ? r.rationale : 'No reading available',
      measuredAt: r ? r.measuredAt : new Date().toISOString(),
      ok: r ? r.ok : false,
      error: r?.error,
    };
  });

  const composite = contributors.reduce((sum, c) => sum + c.contribution, 0);

  // Per-category aggregation (weighted avg within category)
  const cats: SourceCategory[] = ['markets', 'conflicts', 'sentiment', 'military', 'diplomacy'];
  const categories = {} as CompositeIndex['categories'];
  for (const cat of cats) {
    const inCat = contributors.filter((c) => c.category === cat && c.ok);
    const catWeightTotal = inCat.reduce((s, c) => s + c.weight, 0);
    if (catWeightTotal <= 0) {
      categories[cat] = { score: 0, weight: 0, band: 'green' };
      continue;
    }
    const catScore = inCat.reduce((s, c) => s + (c.weight / catWeightTotal) * c.score, 0);
    categories[cat] = { score: catScore, weight: catWeightTotal, band: bandFor(catScore) };
  }

  return {
    score: composite,
    band: bandFor(composite),
    computedAt: new Date().toISOString(),
    contributors,
    categories,
  };
}

/**
 * A failed fetch must not make the source vanish from the composite: with
 * weights renormalised across OK sources, one flaky API (GDELT 429, a token
 * that expired overnight) would shift the whole index every time it flips.
 * So, while the last good reading is still inside the source's staleness
 * window (2 refresh intervals + 1 scheduler tick, the same limit `ww3_frescura`
 * reports), the composite keeps using it. The error stays visible on the
 * contributor and in the stored reading, so freshness reporting is unchanged.
 */
export function pickEffective(
  latest: SourceReading,
  history: SourceReading[],
  refreshIntervalSec: number,
  schedulerIntervalSec: number,
  nowMs: number,
): SourceReading {
  if (latest.ok) return latest;
  const lastGood = history.find((r) => r.ok);
  if (!lastGood) return latest;
  const ageSec = (nowMs - Date.parse(lastGood.measuredAt)) / 1000;
  const staleAfterSec = 2 * refreshIntervalSec + schedulerIntervalSec;
  if (!Number.isFinite(ageSec) || ageSec > staleAfterSec) return latest;
  return {
    ...lastGood,
    error: latest.error,
    meta: { ...(lastGood.meta ?? {}), usedLastGood: true, lastGoodAt: lastGood.measuredAt },
  };
}

export async function safeFetch(source: DataSource): Promise<SourceReading> {
  try {
    const r = await source.fetch();
    return r;
  } catch (err) {
    return errorReading(source.id, err);
  }
}
