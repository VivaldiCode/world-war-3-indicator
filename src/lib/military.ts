/**
 * Live-path loader for the military dataset produced offline by
 * `scripts/military.ts` (→ src/data/military.json). Pure data + lookups; no
 * network, no Ollama. The map layer reads from here.
 */
import data from '@/data/military.json';
import { normalizeCountry, CANONICAL_COUNTRIES } from '@/lib/countryNames';

/** One country's military footprint. All fields optional — sources have gaps. */
export interface MilitaryRecord {
  country: string;
  personnel?: number;
  tanks?: number;
  aircraft?: number; // combat aircraft
  attackHelicopters?: number;
  warships?: number; // carriers + amphibious + cruisers + destroyers + frigates + corvettes
  submarines?: number; // nuclear + diesel
  nuclearWeapons?: number;
  militarySatellites?: number;
}

export interface MilitaryDataset {
  updatedAt: string;
  sources: { personnel: string; equipment: string };
  countries: Record<string, MilitaryRecord>;
}

export const MILITARY = data as MilitaryDataset;
export const MILITARY_LIST: MilitaryRecord[] = Object.values(MILITARY.countries);

const byName = new Map<string, MilitaryRecord>(Object.entries(MILITARY.countries));

/** Lookup by canonical name; falls back to normalizing a raw/aliased name. */
export function militaryByName(name: string): MilitaryRecord | undefined {
  const direct = byName.get(name);
  if (direct) return direct;
  const canon = normalizeCountry(name);
  return canon ? byName.get(canon) : undefined;
}

// Even-spread hue per canonical country via the golden angle, so neighbours on
// the map get visibly different colors — the board-game (RISK) look the user
// asked for. Names off the canonical list hash to a stable hue.
const hueByName = new Map<string, number>();
CANONICAL_COUNTRIES.forEach((name, i) => hueByName.set(name, (i * 137.508) % 360));

function hashHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Stable, distinct fill color for a country. `lightness` tunes the band. */
export function countryColor(name: string, lightness = 52): string {
  const canon = normalizeCountry(name) ?? name;
  const hue = hueByName.get(canon) ?? hashHue(canon);
  return `hsl(${hue.toFixed(0)} 55% ${lightness}%)`;
}
