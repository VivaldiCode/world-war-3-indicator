#!/usr/bin/env tsx
/**
 * Offline military-power pipeline. Scrapes two Wikipedia tables into a single
 * map-keyed JSON blob (`src/data/military.json`) that the live site reads at
 * request time. Production never runs this — it runs on the dev machine and
 * the JSON is committed.
 *
 *   pnpm military            # no-op if the JSON is < 24h old
 *   pnpm military --force    # always re-fetch
 *   pnpm military --no-ollama # skip the Ollama name-matching fallback
 *
 * Parsing is deterministic cheerio indexing: Ollama mis-aligned the equipment
 * table's split "budget" column, so it's used only to resolve the few country
 * names our static alias table misses (honoring "usar o ollama no mac").
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { normalizeCountry, CANONICAL_COUNTRIES } from '../src/lib/countryNames';
import { ollamaReachable, ollamaGenerateJSON } from '../src/lib/ollama';
import type { MilitaryRecord, MilitaryDataset } from '../src/lib/military';

const PERSONNEL_URL =
  'https://en.wikipedia.org/wiki/List_of_countries_by_number_of_military_and_paramilitary_personnel';
const EQUIPMENT_URL =
  'https://en.wikipedia.org/wiki/List_of_countries_by_level_of_military_equipment';

const OUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/military.json');
const DAY_MS = 24 * 60 * 60 * 1000;

const UA = 'ww3-indicator-bot/0.1 (+https://github.com/VivaldiCode/world-war-3-indicator)';

async function fetchHTML(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

/** First integer in a cell, or undefined for "—" / "N/a" / blank. Keeps 0. */
function num(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/\[[^\]]*\]/g, ''); // drop [1] refs
  const m = cleaned.match(/\d[\d,\s]*/);
  if (!m) return undefined;
  const n = parseInt(m[0].replace(/[,\s]/g, ''), 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Sum of the defined values; undefined only if every input is undefined. */
function sumDefined(...vals: Array<number | undefined>): number | undefined {
  const present = vals.filter((v): v is number => typeof v === 'number');
  return present.length === 0 ? undefined : present.reduce((a, b) => a + b, 0);
}

/** All `<td>` texts of a row, whitespace-collapsed. Avoids naming DOM types. */
function rowCells($: cheerio.CheerioAPI, tr: Parameters<typeof $>[0]): string[] {
  return $(tr)
    .find('td')
    .toArray()
    .map((td) => $(td).text().replace(/\s+/g, ' ').trim());
}

// ── personnel ────────────────────────────────────────────────────────────────
// Sortable wikitable: col[0] = country, col[1] = active military personnel.
async function parsePersonnel(): Promise<Map<string, number>> {
  const $ = cheerio.load(await fetchHTML(PERSONNEL_URL));
  const table = $('table.wikitable').first();
  const out = new Map<string, number>();
  let unresolved = 0;
  table.find('tbody > tr').each((_, tr) => {
    const cells = rowCells($, tr);
    if (cells.length < 2) return;
    const rawCountry = cells[0];
    const active = num(cells[1]);
    if (active === undefined) return;
    const canon = normalizeCountry(rawCountry);
    if (!canon) {
      unresolved++;
      return;
    }
    out.set(canon, active);
  });
  console.log(`[military] personnel: ${out.size} countries (${unresolved} names unresolved)`);
  return out;
}

// ── equipment ──────────────────────────────────────────────────────────────
// Wide table. The "budget" column splits into 2 cells on most rows (17 total)
// but is a single "—N/a" cell on ~20 (16 total), shifting every value column
// left by one. Branch on cell count: values start at index 3 (17-cell) or 2.
interface EquipRow {
  canon: string;
  tanks?: number;
  combatAircraft?: number;
  attackHeli?: number;
  warships?: number;
  submarines?: number;
  nuclearWeapons?: number;
  militarySatellites?: number;
}

async function parseEquipment(): Promise<{ rows: EquipRow[]; unresolved: string[] }> {
  const $ = cheerio.load(await fetchHTML(EQUIPMENT_URL));
  const table = $('table.wikitable').first();
  table.find('style').remove();
  const rows: EquipRow[] = [];
  const unresolved: string[] = [];

  table.find('tbody > tr').each((_, tr) => {
    const cells = rowCells($, tr);
    if (cells.length < 16) return; // header / malformed
    const rawCountry = cells[0];
    if (!rawCountry) return;
    const canon = normalizeCountry(rawCountry);
    if (!canon) {
      if (rawCountry.length > 1) unresolved.push(rawCountry);
      return;
    }

    const base = cells.length >= 17 ? 3 : 2; // value columns start here
    const at = (i: number) => num(cells[base + i]);
    const tanks = at(0);
    const carriers = at(1);
    const amphibious = at(2);
    const cruisers = at(3);
    const destroyers = at(4);
    const frigates = at(5);
    const corvettes = at(6);
    const nuclearSub = at(7);
    const nonNucSub = at(8);
    const combatAircraft = at(9);
    const attackHeli = at(10);
    const nuclearWeapons = at(11);
    const militarySatellites = at(12);

    rows.push({
      canon,
      tanks,
      combatAircraft,
      attackHeli,
      warships: sumDefined(carriers, amphibious, cruisers, destroyers, frigates, corvettes),
      submarines: sumDefined(nuclearSub, nonNucSub),
      nuclearWeapons,
      militarySatellites,
    });
  });

  console.log(`[military] equipment: ${rows.length} countries (${unresolved.length} unresolved)`);
  return { rows, unresolved };
}

// ── Ollama fallback ──────────────────────────────────────────────────────────
// Only for names our static alias table misses. Ask the local model to map each
// to a canonical name or null; apply only answers that hit a real canonical.
async function resolveWithOllama(names: string[]): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  if (names.length === 0) return resolved;
  if (!(await ollamaReachable())) {
    console.log('[military] ollama unreachable — leaving names unresolved');
    return resolved;
  }
  const prompt = [
    'Match each input country name to exactly one canonical name from the list,',
    'or null if none is a confident match (e.g. micro-states not in the list).',
    'Return ONLY a JSON object mapping input -> canonical-or-null.',
    '',
    `CANONICAL = ${JSON.stringify(CANONICAL_COUNTRIES)}`,
    `INPUTS = ${JSON.stringify(names)}`,
  ].join('\n');
  try {
    const ans = await ollamaGenerateJSON<Record<string, string | null>>(prompt, { numCtx: 8192 });
    const canonSet = new Set(CANONICAL_COUNTRIES);
    for (const [raw, target] of Object.entries(ans)) {
      if (target && canonSet.has(target)) resolved.set(raw, target);
    }
    console.log(`[military] ollama resolved ${resolved.size}/${names.length} extra names`);
  } catch (err) {
    console.log(`[military] ollama fallback failed: ${(err as Error).message.slice(0, 120)}`);
  }
  return resolved;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const force = process.argv.includes('--force');
  const noOllama = process.argv.includes('--no-ollama');

  if (!force && existsSync(OUT_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(OUT_PATH, 'utf8')) as MilitaryDataset;
      const age = Date.now() - new Date(prev.updatedAt).getTime();
      if (Number.isFinite(age) && age < DAY_MS) {
        const hrs = (age / 3600_000).toFixed(1);
        console.log(`[military] up to date (${hrs}h old). Use --force to refresh.`);
        process.exit(0);
      }
    } catch {
      /* unreadable — fall through and rebuild */
    }
  }

  const [personnel, equip] = await Promise.all([parsePersonnel(), parseEquipment()]);

  // Try Ollama on the equipment names we couldn't place, then re-resolve.
  if (!noOllama && equip.unresolved.length > 0) {
    const extra = await resolveWithOllama(equip.unresolved);
    // (extra mappings are advisory; equipment rows already dropped unresolved
    //  names, and the misses are micro-states absent from the map — logged below)
    if (extra.size > 0) {
      console.log(`[military] note: ${[...extra.entries()].map(([k, v]) => `${k}→${v}`).join(', ')}`);
    }
  }

  const countries: Record<string, MilitaryRecord> = {};
  const rec = (canon: string): MilitaryRecord => (countries[canon] ??= { country: canon });

  for (const [canon, p] of personnel) rec(canon).personnel = p;
  for (const r of equip.rows) {
    const m = rec(r.canon);
    if (r.tanks !== undefined) m.tanks = r.tanks;
    if (r.combatAircraft !== undefined) m.aircraft = r.combatAircraft;
    if (r.attackHeli !== undefined) m.attackHelicopters = r.attackHeli;
    if (r.warships !== undefined) m.warships = r.warships;
    if (r.submarines !== undefined) m.submarines = r.submarines;
    if (r.nuclearWeapons !== undefined) m.nuclearWeapons = r.nuclearWeapons;
    if (r.militarySatellites !== undefined) m.militarySatellites = r.militarySatellites;
  }

  const sorted = Object.fromEntries(Object.entries(countries).sort(([a], [b]) => a.localeCompare(b)));
  const dataset: MilitaryDataset = {
    updatedAt: new Date().toISOString(),
    sources: { personnel: PERSONNEL_URL, equipment: EQUIPMENT_URL },
    countries: sorted,
  };
  writeFileSync(OUT_PATH, JSON.stringify(dataset, null, 2) + '\n');

  // Sanity block — eyeball against known figures before trusting the run.
  const show = (n: string) => {
    const m = countries[n];
    if (!m) return console.log(`  ${n}: (missing)`);
    console.log(
      `  ${n}: troops=${m.personnel} tanks=${m.tanks} air=${m.aircraft} ships=${m.warships} subs=${m.submarines} nukes=${m.nuclearWeapons} sats=${m.militarySatellites}`,
    );
  };
  console.log(`[military] wrote ${Object.keys(sorted).length} countries → ${OUT_PATH}`);
  show('United States of America');
  show('Russia');
  show('China');
  show('France');
  process.exit(0);
}

main().catch((err) => {
  console.error('[military] fatal:', err);
  process.exit(1);
});
