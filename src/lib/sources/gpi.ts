import type { DataSource, SourceReading } from '../types';
import { fetchText } from '../http';
import { bandFor, clamp, piecewise, reading } from '../scoring';
import { GPI_GLOBAL_AVERAGE } from '@/data/historical_annual';

/**
 * Global Peace Index (GPI) — Institute for Economics & Peace. Published
 * annually. We use the latest published global average score.
 *
 * The IEP/Vision-of-Humanity pages are heavily client-rendered, so scraping
 * the score reliably is hard. We pin it to the latest known release and
 * opportunistically try to upgrade via Wikipedia's article (which gets
 * edited when a new GPI comes out).
 *
 * GPI scale: 1 (most peaceful) → 5 (least peaceful). World avg has crept up.
 */
export const globalPeaceIndexSource: DataSource = {
  id: 'global-peace-index',
  name: 'Global Peace Index',
  description:
    'Composite peacefulness score across 163 countries (1 = peaceful, 5 = least). Published annually by the Institute for Economics & Peace.',
  provider: 'Vision of Humanity / IEP',
  providerUrl: 'https://www.visionofhumanity.org/',
  category: 'military',
  weight: 6,
  refreshIntervalSec: 60 * 60 * 24 * 30,
  unit: 'GPI',
  scoringExplanation:
    'GPI 2.0 ≈ very peaceful (score 0). GPI 2.5 ≈ 50. GPI 2.8+ ≈ red. Refreshes once a year.',
  async fetch() {
    // Latest published GPI score (2024 edition). Update when IEP publishes a new one.
    const pinned = { gpi: 2.443, edition: 2024 };
    let gpi = pinned.gpi;
    let edition = pinned.edition;
    let provenance: 'pinned' | 'wikipedia' = 'pinned';
    try {
      const html = await fetchText('https://en.wikipedia.org/wiki/Global_Peace_Index');
      // Look for "2024 GPI ... 2.443" or similar — the article's infobox + tables
      // usually contain the most recent global average.
      const m = html.match(
        /(?:Global average|world(?:'s)? average|world score|global score)[^\d]{0,40}(2\.[0-9]{2,3})/i,
      );
      if (m) {
        const candidate = Number(m[1]);
        if (candidate >= 1.5 && candidate <= 3.5) {
          gpi = candidate;
          provenance = 'wikipedia';
        }
      }
      const ed = html.match(/(?:Global Peace Index|GPI)\s+(20[2-9][0-9])/);
      if (ed) edition = Number(ed[1]);
    } catch {
      // best-effort upgrade; fall back to pinned
    }
    const score = piecewise(gpi, [
      [1.8, 0],
      [2.2, 30],
      [2.4, 50],
      [2.6, 70],
      [2.9, 100],
    ]);
    return reading({
      sourceId: globalPeaceIndexSource.id,
      raw: gpi,
      rawUnit: 'GPI',
      score,
      rationale: `Global Peace Index ${edition} avg ≈ ${gpi.toFixed(3)} (${provenance}).`,
      meta: { edition, provenance },
    });
  },
  async backfill(opts) {
    const fromMs = opts.from ? Date.parse(opts.from) : -Infinity;
    const toMs = opts.to ? Date.parse(opts.to) : Date.now();
    const out: SourceReading[] = [];
    for (const { year, value } of GPI_GLOBAL_AVERAGE) {
      // GPI editions publish in May/June each year — anchor on May 31.
      const ts = Date.UTC(year, 4, 31);
      if (ts < fromMs || ts > toMs) continue;
      const score = clamp(piecewise(value, [
        [1.8, 0],
        [2.2, 30],
        [2.4, 50],
        [2.6, 70],
        [2.9, 100],
      ]));
      out.push({
        sourceId: globalPeaceIndexSource.id,
        measuredAt: new Date(ts).toISOString(),
        raw: value,
        rawUnit: 'GPI',
        score,
        band: bandFor(score),
        rationale: `GPI ${year} avg ${value.toFixed(3)} (IEP historical).`,
        ok: true,
        meta: { edition: year, backfilled: true, source: 'gpi-annual' },
      });
    }
    return out;
  },
};
