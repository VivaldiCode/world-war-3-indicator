/**
 * Recent conflict-incident model. `scripts/conflicts.ts` distils the GDELT 2.0
 * Events stream into a small set of weighted, geo-located flashpoints and commits
 * them as `src/data/conflicts.json`; the forces map renders them as incident
 * markers. Like the other offline datasets this is refreshed at most once a day.
 *
 * Each event keeps its dominant CAMEO *root* code; `catForRoot` maps that to the
 * handful of buckets we colour on the map. Material conflict spans CAMEO roots
 * 15–20, so those are the only ones that appear.
 */
import data from '@/data/conflicts.json';

export type ConflictCat =
  | 'fight'
  | 'assault'
  | 'mass_violence'
  | 'coerce'
  | 'force_posture'
  | 'reduce_relations'
  | 'other';

export interface ConflictEvent {
  lat: number;
  lon: number;
  root: string; // dominant CAMEO root code, e.g. "19"
  place: string; // ActionGeo full name
  country: string; // FIPS country code
  mentions: number; // summed news mentions in the window
  events: number; // raw event rows collapsed into this point
  tone: number; // average GDELT tone (negative = darker)
}

export interface ConflictDataset {
  updatedAt: string;
  source: string;
  windowHours: number;
  events: ConflictEvent[];
}

export const CONFLICTS = data as ConflictDataset;

// CAMEO root code → bucket. (15 force posture, 16 reduce relations, 17 coerce,
// 18 assault, 19 fight, 20 unconventional mass violence.)
const ROOT_TO_CAT: Record<string, ConflictCat> = {
  '15': 'force_posture',
  '16': 'reduce_relations',
  '17': 'coerce',
  '18': 'assault',
  '19': 'fight',
  '20': 'mass_violence',
};

export function catForRoot(root: string): ConflictCat {
  return ROOT_TO_CAT[root] ?? 'other';
}

export const CONFLICT_CATS: Record<ConflictCat, { label: string; color: string }> = {
  mass_violence: { label: 'Mass violence', color: '#7d1128' },
  fight: { label: 'Armed clash', color: '#c0392b' },
  assault: { label: 'Assault', color: '#e07b39' },
  coerce: { label: 'Coercion', color: '#cda434' },
  force_posture: { label: 'Force posture', color: '#5b7a99' },
  reduce_relations: { label: 'Reduced relations', color: '#8a7f9c' },
  other: { label: 'Other', color: '#9aa0a6' },
};

/** Categories present, ordered by severity (most violent first) then count. */
export function conflictCatsPresent(events: ConflictEvent[]): ConflictCat[] {
  const rank: ConflictCat[] = ['mass_violence', 'fight', 'assault', 'coerce', 'force_posture', 'reduce_relations', 'other'];
  const seen = new Set<ConflictCat>();
  for (const e of events) seen.add(catForRoot(e.root));
  return rank.filter((c) => seen.has(c));
}
