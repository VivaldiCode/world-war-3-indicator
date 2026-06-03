/**
 * Live-path loader for the orbital dataset produced offline by
 * `scripts/satellites.ts` (→ src/data/satellites.json). Pure data + the owner
 * palette; no network, no propagation. The forces map projects + animates
 * these elements on the client (see `@/lib/orbit`).
 */
import data from '@/data/satellites.json';

/** Constellation / station the satellite belongs to. */
export type SatOwner =
  | 'gps' | 'glonass' | 'beidou' | 'galileo' | 'starlink' | 'iss' | 'css';

/**
 * Mean Keplerian elements at epoch, parsed from a TLE. Angles in degrees,
 * mean motion in revolutions/day — the client converts to radians and
 * propagates. Eccentricity is tiny for every set we ship (near-circular).
 */
export interface SatElements {
  name: string;
  norad: number;
  owner: SatOwner;
  epochMs: number; // UTC epoch of the elements
  inclDeg: number; // inclination
  raanDeg: number; // right ascension of ascending node
  ecc: number; // eccentricity
  argpDeg: number; // argument of perigee
  maDeg: number; // mean anomaly at epoch
  meanMotion: number; // revolutions per day
}

export interface SatelliteDataset {
  updatedAt: string;
  source: string;
  satellites: SatElements[];
}

/**
 * Owner → legend label, owning nation, and dot color. Colors are saturated
 * but earthy enough to sit over the parchment map; each dot also gets a dark
 * stroke for contrast against the flag fills. GPS and Starlink are both US but
 * kept visually distinct (blue vs cyan), as are BeiDou and the CSS station
 * (gold vs burnt orange).
 */
export const SAT_OWNERS: Record<SatOwner, { label: string; country: string; color: string }> = {
  gps: { label: 'GPS', country: 'USA', color: '#2f6fb0' },
  glonass: { label: 'GLONASS', country: 'Russia', color: '#c0392b' },
  beidou: { label: 'BeiDou', country: 'China', color: '#e0a526' },
  galileo: { label: 'Galileo', country: 'EU', color: '#8e5bbf' },
  starlink: { label: 'Starlink', country: 'USA', color: '#3fb8cf' },
  iss: { label: 'ISS', country: 'Intl.', color: '#f2ead0' },
  css: { label: 'CSS', country: 'China', color: '#d2691e' },
};

export const SATELLITES = data as SatelliteDataset;

/** Owners actually present in the dataset, in palette order — for the legend. */
const OWNER_ORDER: SatOwner[] = ['gps', 'glonass', 'beidou', 'galileo', 'starlink', 'iss', 'css'];
export function ownersPresent(sats: SatElements[]): SatOwner[] {
  const seen = new Set(sats.map((s) => s.owner));
  return OWNER_ORDER.filter((o) => seen.has(o));
}
