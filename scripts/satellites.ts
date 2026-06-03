#!/usr/bin/env tsx
/**
 * Offline orbital-elements pipeline. Pulls TLEs for a handful of national
 * constellations + Starlink + crewed stations from CelesTrak, parses the mean
 * Keplerian elements out of each TLE, and writes them to
 * `src/data/satellites.json`. The live site never runs this — it reads the
 * committed JSON and propagates client-side (see `@/lib/orbit`).
 *
 *   npm run satellites           # no-op if the JSON is < 24h old
 *   npm run satellites -- --force  # always re-fetch
 *
 * CelesTrak asks callers not to hammer the GP endpoint; once a day is plenty
 * since mean elements drift slowly and the animation is illustrative, not a
 * tracking tool.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SatElements, SatOwner, SatelliteDataset } from '../src/lib/satellites';

const GP_BASE = 'https://celestrak.org/NORAD/elements/gp.php';
const OUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/satellites.json');
const DAY_MS = 24 * 60 * 60 * 1000;
const UA = 'ww3-indicator-bot/0.1 (+https://github.com/VivaldiCode/world-war-3-indicator)';

/** Constellation groups that map cleanly to one owning nation, with a cap. */
const GROUPS: Array<{ group: string; owner: SatOwner; cap: number }> = [
  { group: 'gps-ops', owner: 'gps', cap: 40 },
  { group: 'glo-ops', owner: 'glonass', cap: 40 },
  { group: 'beidou', owner: 'beidou', cap: 60 },
  { group: 'galileo', owner: 'galileo', cap: 40 },
  { group: 'starlink', owner: 'starlink', cap: 90 },
];

interface RawTLE { name: string; l1: string; l2: string }

async function fetchGroup(group: string): Promise<RawTLE[]> {
  const res = await fetch(`${GP_BASE}?GROUP=${group}&FORMAT=tle`, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${group}`);
  const lines = (await res.text()).split(/\r?\n/).filter((l) => l.trim().length > 0);
  const out: RawTLE[] = [];
  // Robust to the occasional missing name line: anchor on the "1 …"/"2 …" pair.
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].startsWith('1 ') && lines[i + 1].startsWith('2 ')) {
      const name = i > 0 && !lines[i - 1].startsWith('2 ') ? lines[i - 1] : `SAT ${lines[i].slice(2, 7)}`;
      out.push({ name, l1: lines[i], l2: lines[i + 1] });
      i++; // consume line 2
    }
  }
  return out;
}

/** Parse the mean elements out of a TLE pair. Null on malformed lines. */
function parseTLE(name: string, l1: string, l2: string, owner: SatOwner): SatElements | null {
  if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) return null;
  const norad = parseInt(l1.slice(2, 7), 10);
  const epochStr = l1.slice(18, 32).trim(); // YYDDD.DDDDDDDD
  const yy = parseInt(epochStr.slice(0, 2), 10);
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  const doy = parseFloat(epochStr.slice(2)); // day-of-year (1-based) + fraction
  const inclDeg = parseFloat(l2.slice(8, 16));
  const raanDeg = parseFloat(l2.slice(17, 25));
  const ecc = parseFloat('0.' + l2.slice(26, 33).trim());
  const argpDeg = parseFloat(l2.slice(34, 42));
  const maDeg = parseFloat(l2.slice(43, 51));
  const meanMotion = parseFloat(l2.slice(52, 63));
  const nums = [norad, doy, inclDeg, raanDeg, ecc, argpDeg, maDeg, meanMotion];
  if (!nums.every(Number.isFinite) || meanMotion <= 0) return null;
  const epochMs = Date.UTC(year, 0, 1) + (doy - 1) * DAY_MS;
  return { name: name.trim(), norad, owner, epochMs, inclDeg, raanDeg, ecc, argpDeg, maDeg, meanMotion };
}

/** Evenly thin an array down to `cap` entries (keeps spatial spread). */
function stride<T>(arr: T[], cap: number): T[] {
  if (arr.length <= cap) return arr;
  const step = arr.length / cap;
  return Array.from({ length: cap }, (_, i) => arr[Math.floor(i * step)]);
}

/** Crewed stations we care about; everything else in `stations` is dropped. */
function stationOwner(name: string): SatOwner | null {
  const n = name.toUpperCase();
  if (n.includes('ISS') || n.includes('ZARYA')) return 'iss';
  if (n.includes('CSS') || n.includes('TIANHE') || n.includes('TIANGONG')) return 'css';
  return null;
}

async function main() {
  const force = process.argv.includes('--force');

  if (!force && existsSync(OUT_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(OUT_PATH, 'utf8')) as SatelliteDataset;
      const age = Date.now() - new Date(prev.updatedAt).getTime();
      if (Number.isFinite(age) && age < DAY_MS) {
        console.log(`[sats] up to date (${(age / 3600_000).toFixed(1)}h old). Use --force to refresh.`);
        process.exit(0);
      }
    } catch {
      /* unreadable — rebuild */
    }
  }

  const sats: SatElements[] = [];
  const counts: Record<string, number> = {};

  for (const { group, owner, cap } of GROUPS) {
    const raw = await fetchGroup(group);
    const parsed = raw
      .map((r) => parseTLE(r.name, r.l1, r.l2, owner))
      .filter((s): s is SatElements => s !== null);
    const kept = stride(parsed, cap);
    counts[owner] = (counts[owner] ?? 0) + kept.length;
    sats.push(...kept);
    console.log(`[sats] ${group}: ${raw.length} fetched → ${parsed.length} parsed → ${kept.length} kept (${owner})`);
  }

  // Stations: only the crewed ones, tagged ISS or CSS.
  const stations = await fetchGroup('stations');
  for (const r of stations) {
    const owner = stationOwner(r.name);
    if (!owner) continue;
    const s = parseTLE(r.name, r.l1, r.l2, owner);
    if (!s) continue;
    counts[owner] = (counts[owner] ?? 0) + 1;
    sats.push(s);
  }
  console.log(`[sats] stations: ${stations.length} fetched → kept ISS/CSS`);

  sats.sort((a, b) => a.owner.localeCompare(b.owner) || a.norad - b.norad);
  const dataset: SatelliteDataset = {
    updatedAt: new Date().toISOString(),
    source: GP_BASE,
    satellites: sats,
  };
  writeFileSync(OUT_PATH, JSON.stringify(dataset, null, 2) + '\n');

  console.log(`[sats] wrote ${sats.length} satellites → ${OUT_PATH}`);
  console.log(`[sats] by owner: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[sats] fatal:', err);
  process.exit(1);
});
