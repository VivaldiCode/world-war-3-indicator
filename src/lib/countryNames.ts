/**
 * Maps arbitrary country names (as they appear in Wikipedia tables, news
 * feeds, datasets) onto the exact `properties.name` strings used by the
 * world-atlas topojson that drives the map. Everything military-related is
 * keyed by these canonical names so it lines up with a drawable country shape.
 *
 * Strategy: deterministic first (clean → exact → alias → fuzzy). The military
 * pipeline calls Ollama only for the handful of names this can't resolve.
 */
import worldData from '@/data/world-110m.json';

interface Geo {
  properties?: { name?: string };
}

/** The 177 canonical country names, straight from the topology. */
export const CANONICAL_COUNTRIES: string[] = (
  (worldData as unknown as { objects: { countries: { geometries: Geo[] } } }).objects.countries
    .geometries.map((g) => g.properties?.name)
    .filter((n): n is string => Boolean(n))
).sort();

/** Lowercase, strip diacritics, drop refs/parentheticals/punctuation. */
function clean(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritics
    .replace(/\[[^\]]*\]/g, '') // [1] refs
    .replace(/\([^)]*\)/g, '') // (parentheticals)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.,'’\-–—/]/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// cleaned-canonical → canonical
const byClean = new Map<string, string>();
for (const c of CANONICAL_COUNTRIES) byClean.set(clean(c), c);

/**
 * Known divergences between common usage and the world-atlas spelling. Keys
 * are passed through `clean()` before lookup, so write them however reads best.
 */
const ALIASES: Record<string, string> = {
  'united states': 'United States of America',
  usa: 'United States of America',
  us: 'United States of America',
  'u s a': 'United States of America',
  america: 'United States of America',
  uk: 'United Kingdom',
  'great britain': 'United Kingdom',
  britain: 'United Kingdom',
  england: 'United Kingdom',
  'czech republic': 'Czechia',
  'democratic republic of the congo': 'Dem. Rep. Congo',
  'dr congo': 'Dem. Rep. Congo',
  drc: 'Dem. Rep. Congo',
  'congo kinshasa': 'Dem. Rep. Congo',
  'republic of the congo': 'Congo',
  'congo brazzaville': 'Congo',
  'ivory coast': "Côte d'Ivoire",
  'cote d ivoire': "Côte d'Ivoire",
  burma: 'Myanmar',
  'south korea': 'South Korea',
  'republic of korea': 'South Korea',
  korea: 'South Korea',
  'north korea': 'North Korea',
  dprk: 'North Korea',
  'korea dprk': 'North Korea',
  uae: 'United Arab Emirates',
  'bosnia and herzegovina': 'Bosnia and Herz.',
  bosnia: 'Bosnia and Herz.',
  'central african republic': 'Central African Rep.',
  'dominican republic': 'Dominican Rep.',
  'south sudan': 'S. Sudan',
  'equatorial guinea': 'Eq. Guinea',
  eswatini: 'eSwatini',
  swaziland: 'eSwatini',
  'east timor': 'Timor-Leste',
  'timor leste': 'Timor-Leste',
  turkiye: 'Turkey',
  'russian federation': 'Russia',
  'syrian arab republic': 'Syria',
  iran: 'Iran',
  'islamic republic of iran': 'Iran',
  laos: 'Laos',
  'lao pdr': 'Laos',
  moldova: 'Moldova',
  'republic of moldova': 'Moldova',
  'united republic of tanzania': 'Tanzania',
  'north macedonia': 'Macedonia',
  'state of palestine': 'Palestine',
  'palestinian territories': 'Palestine',
  'the gambia': 'Gambia',
  'the bahamas': 'Bahamas',
  brunei: 'Brunei',
  'brunei darussalam': 'Brunei',
  'west sahara': 'W. Sahara',
  'western sahara': 'W. Sahara',
  'northern cyprus': 'N. Cyprus',
  'solomon islands': 'Solomon Is.',
  'falkland islands': 'Falkland Is.',
  'vatican city': 'Vatican',
};

// Bake aliases into the lookup (skip any whose target isn't a real canonical).
const canonicalSet = new Set(CANONICAL_COUNTRIES);
for (const [alias, target] of Object.entries(ALIASES)) {
  if (canonicalSet.has(target)) byClean.set(clean(alias), target);
}

/**
 * Resolve `raw` to a canonical country name, or `null` if there's no confident
 * match. Tries exact-clean, then alias, then a loose containment fuzzy pass.
 */
export function normalizeCountry(raw: string): string | null {
  if (!raw) return null;
  const key = clean(raw);
  if (!key) return null;
  const direct = byClean.get(key);
  if (direct) return direct;

  // Fuzzy: a canonical key fully contained in the input (or vice-versa) and
  // long enough to be unambiguous. Guards against 'guinea' matching 3 countries.
  let best: string | null = null;
  for (const [ck, canon] of byClean) {
    if (ck.length < 4) continue;
    if (key === ck) return canon;
    if ((key.startsWith(ck + ' ') || key.endsWith(' ' + ck) || key === ck) && ck.length >= 6) {
      best = canon;
    }
  }
  return best;
}
