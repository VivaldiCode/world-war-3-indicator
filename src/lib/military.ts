/**
 * Live-path loader for the military dataset produced offline by
 * `scripts/military.ts` (→ src/data/military.json). Pure data + lookups; no
 * network, no Ollama. The map layer reads from here.
 */
import data from '@/data/military.json';
import { normalizeCountry } from '@/lib/countryNames';

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
