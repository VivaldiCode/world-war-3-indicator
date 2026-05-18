import type { DataSource } from '../types';
import { fetchText } from '../http';
import { piecewise, reading } from '../scoring';

/**
 * Ongoing armed-conflicts tier counts — scraped from the well-maintained
 * Wikipedia "List of ongoing armed conflicts" article. The article groups
 * active conflicts by current-year fatality bands:
 *
 *   - Major wars (10,000+ combat deaths/yr)
 *   - Wars (1,000–9,999)
 *   - Minor conflicts (100–999)
 *   - Skirmishes (1–99)
 *
 * This source is a graceful, open-data replacement for UCDP after their API
 * went auth-gated.
 */
export const ucdpConflictsSource: DataSource = {
  id: 'wikipedia-conflicts',
  name: 'Ongoing Armed Conflicts (Wikipedia)',
  description:
    'Number of active armed conflicts by fatality tier from the live Wikipedia "List of ongoing armed conflicts". Major wars (>10k deaths/yr) are heavily weighted.',
  provider: 'Wikipedia',
  providerUrl: 'https://en.wikipedia.org/wiki/List_of_ongoing_armed_conflicts',
  category: 'conflicts',
  weight: 9,
  refreshIntervalSec: 60 * 60 * 12,
  unit: 'conflicts',
  scoringExplanation:
    'Weighted count of conflicts: a major war is worth 10 points, a war 4, a minor conflict 1, a skirmish 0.3. Result mapped to 0..100.',
  async fetch() {
    const html = await fetchText(
      'https://en.wikipedia.org/wiki/List_of_ongoing_armed_conflicts',
    );
    // The article begins each tier section with a stable sentence:
    //   "The 8 conflicts in the following list have caused at least 10,000 …"
    //   "The 12 conflicts in the following list have caused …"
    // Section order is fixed: Major wars → Wars → Minor conflicts → Skirmishes.
    const counts: number[] = [];
    const re = /The\s+(\d+)\s+conflicts?\s+in\s+the\s+following\s+list/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) counts.push(Number(m[1]));
    if (counts.length < 4) {
      throw new Error(
        `Wikipedia conflict-list parser found ${counts.length} tier sentences (expected 4)`,
      );
    }
    const tiers = {
      major: counts[0],
      war: counts[1],
      minor: counts[2],
      skirmish: counts[3],
    };
    const total = tiers.major + tiers.war + tiers.minor + tiers.skirmish;
    // Severity-weighted intensity index
    const intensity =
      tiers.major * 10 + tiers.war * 4 + tiers.minor * 1 + tiers.skirmish * 0.3;
    const score = piecewise(intensity, [
      [10, 0],
      [30, 30],
      [55, 50],
      [85, 75],
      [130, 100],
    ]);
    return reading({
      sourceId: ucdpConflictsSource.id,
      raw: total,
      rawUnit: 'conflicts',
      score,
      rationale:
        `${tiers.major} major wars, ${tiers.war} wars, ${tiers.minor} minor conflicts, ${tiers.skirmish} skirmishes ` +
        `(intensity ${intensity.toFixed(1)}).`,
      meta: { ...tiers, total, intensity },
    });
  },
};
