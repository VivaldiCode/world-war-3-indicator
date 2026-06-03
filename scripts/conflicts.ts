#!/usr/bin/env tsx
/**
 * Offline conflict-events pipeline. Pulls the last few hours of the GDELT 2.0
 * Events stream (a new file every 15 minutes), keeps only *material conflict*
 * events that carry a map coordinate, clusters them onto a coarse grid, and
 * writes a compact `src/data/conflicts.json` the forces map renders as incident
 * markers. Production never runs this — it runs on the dev machine and the JSON
 * is committed, refreshed at most once a day like the other offline datasets.
 *
 *   npm run conflicts            # no-op if the JSON is < 24h old
 *   npm run conflicts -- --force # always re-fetch
 *
 * Why GDELT and not Liveuamap: Liveuamap's geo feed sits behind a paid, gated
 * devapi (the public endpoint always returns {success:false}), and GDELT's own
 * GEO 2.0 API now 404s. The raw 15-minute Events export is free, keyless and
 * carries ActionGeo_Lat/Long + a CAMEO event code per row — exactly what a
 * marker layer needs. Each row is re-grounded: only QuadClass 4 (material
 * conflict) rows with a finite coordinate survive, and nearby rows collapse to
 * one weighted point so a single flashpoint isn't drawn a hundred times.
 *
 * Unzipping is shelled out to `unzip -p` (present on the dev Mac) to avoid
 * adding a zip dependency to a project whose runtime never touches these files.
 */
import { writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import type { ConflictEvent, ConflictDataset } from '../src/lib/conflicts';

const LASTUPDATE_URL = 'http://data.gdeltproject.org/gdeltv2/lastupdate.txt';
const FILE_URL = (stamp: string) => `http://data.gdeltproject.org/gdeltv2/${stamp}.export.CSV.zip`;
const OUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/conflicts.json');
const DAY_MS = 24 * 60 * 60 * 1000;
const UA = 'ww3-indicator-bot/0.1 (+https://github.com/VivaldiCode/world-war-3-indicator)';

// 6h (24 windows) is the sweet spot: long enough for a rich snapshot, short
// enough that English-language media hubs (London, Sydney, Toronto…) haven't
// accumulated enough conflict *coverage* to masquerade as flashpoints. Wider
// windows (24h) measurably reintroduce that geocoding bias.
const WINDOWS = 24; // 15-min files to pull (24 → last 6 hours)
const STEP_MS = 15 * 60 * 1000;
const GRID = 0.25; // clustering resolution in degrees
const TOP_N = 200; // strongest clusters to keep
const POLITE_MS = 80; // delay between file fetches (static host, not the rate-limited API)

// GDELT 2.0 Events column indices (0-based).
const COL = { root: 28, quad: 29, mentions: 31, tone: 34, gtype: 51, place: 52, country: 53, lat: 56, lon: 57 };

// Anti-bias knobs. GDELT geocodes news *mentions*, not incident sites, so two
// things skew a naive map: vague country/US-state centroids, and reporting hubs
// (capitals) inflated by diplomatic coverage. We counter both:
//   1. keep only city/province-precise geocodes (ActionGeo_Type 4=world city,
//      5=ADM1) — this drops country centroids (1), US states (2) and US cities
//      (3, incl. the Washington political-hub noise);
//   2. rank by a severity-weighted score so real violence (CAMEO roots 18–20)
//      outranks diplomatic posturing (15–17), demoting hubs like London/Beijing
//      without erasing them (their colour already marks them as "soft").
const PRECISE_TYPES = new Set(['4', '5']);
const ROOT_WEIGHT: Record<string, number> = { '20': 1.5, '19': 1.3, '18': 1.15, '17': 0.55, '16': 0.4, '15': 0.65 };
const rootWeight = (root: string) => ROOT_WEIGHT[root] ?? 0.5;

// Even after weighting, mega media/diplomatic hubs (esp. London) ride their sheer
// mention volume to the top. So drop a hub cluster when its dominant code is
// diplomatic (CAMEO roots 15–17 = posture / reduced relations / coercion) — but
// keep it if it's actual violence (18–20), so a real attack in a capital still
// shows. Coords are (lat, lon); HUB_DEG is the match radius in degrees.
const SOFT_ROOTS = new Set(['15', '16', '17']);
const HUB_DEG = 0.7;
const HUBS: Array<[number, number]> = [
  [51.5, -0.13], // London
  [50.85, 4.35], // Brussels (EU / NATO)
  [46.2, 6.14], // Geneva (UN)
  [48.85, 2.35], // Paris
  [48.58, 7.75], // Strasbourg (EU)
  [48.21, 16.37], // Vienna (UN / OSCE)
  [52.08, 4.3], // The Hague (ICC / ICJ)
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** YYYYMMDDHHMMSS for a Date in UTC, aligned to the GDELT 15-min grid. */
function stampFor(ms: number): string {
  const d = new Date(Math.floor(ms / STEP_MS) * STEP_MS);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Download a .export.CSV.zip and return the decompressed TSV text. */
async function fetchExportCsv(stamp: string, tmp: string): Promise<string> {
  const buf = await fetchBuffer(FILE_URL(stamp));
  const zipPath = join(tmp, `${stamp}.zip`);
  writeFileSync(zipPath, buf);
  // `-p` streams the single archive member to stdout; 64MB cap is plenty.
  const out = execFileSync('unzip', ['-p', zipPath], { maxBuffer: 64 * 1024 * 1024 });
  rmSync(zipPath, { force: true });
  return out.toString('utf8');
}

interface Cluster {
  lat: number;
  lon: number;
  place: string;
  country: string;
  mentions: number;
  events: number;
  wscore: number; // severity-weighted mentions, used only for ranking
  roots: Map<string, number>; // root code → summed mentions, to pick the dominant
  toneSum: number;
}

function ingest(csv: string, clusters: Map<string, Cluster>): void {
  for (const line of csv.split('\n')) {
    if (!line) continue;
    const r = line.split('\t');
    if (r.length < 61) continue;
    if (r[COL.quad] !== '4') continue; // material conflict only
    if (!PRECISE_TYPES.has(r[COL.gtype])) continue; // city/province precision only
    const lat = Number(r[COL.lat]);
    const lon = Number(r[COL.lon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    const root = r[COL.root];
    if (!root) continue;
    const mentions = Math.max(1, Number(r[COL.mentions]) || 1);
    const tone = Number(r[COL.tone]) || 0;
    const key = `${Math.round(lat / GRID)},${Math.round(lon / GRID)}`;

    let c = clusters.get(key);
    if (!c) {
      c = { lat, lon, place: r[COL.place] || '', country: r[COL.country] || '', mentions: 0, events: 0, wscore: 0, roots: new Map(), toneSum: 0 };
      clusters.set(key, c);
    }
    c.mentions += mentions;
    c.events += 1;
    c.wscore += mentions * rootWeight(root);
    c.toneSum += tone;
    c.roots.set(root, (c.roots.get(root) ?? 0) + mentions);
    // Keep the most-mentioned row's place label as representative.
    if (mentions >= c.events && r[COL.place]) c.place = r[COL.place];
  }
}

function dominantRoot(roots: Map<string, number>): string {
  let best = '';
  let bestN = -1;
  for (const [root, n] of roots) if (n > bestN) ((bestN = n), (best = root));
  return best;
}

/** A reporting hub whose top code is merely diplomatic — coverage, not an incident. */
function isHubCoverage(c: Cluster): boolean {
  if (!SOFT_ROOTS.has(dominantRoot(c.roots))) return false;
  return HUBS.some(([la, lo]) => Math.abs(c.lat - la) < HUB_DEG && Math.abs(c.lon - lo) < HUB_DEG);
}

async function main() {
  const force = process.argv.includes('--force');

  if (!force && existsSync(OUT_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(OUT_PATH, 'utf8')) as ConflictDataset;
      const age = Date.now() - new Date(prev.updatedAt).getTime();
      if (Number.isFinite(age) && age < DAY_MS) {
        console.log(`[conflicts] up to date (${(age / 3600_000).toFixed(1)}h old). Use --force.`);
        process.exit(0);
      }
    } catch {
      /* unreadable — rebuild */
    }
  }

  // Anchor on GDELT's published latest file, then walk backwards in 15-min steps.
  let latestMs: number;
  try {
    const txt = (await fetchBuffer(LASTUPDATE_URL)).toString('utf8');
    const m = txt.match(/(\d{14})\.export\.CSV\.zip/);
    if (!m) throw new Error('no export stamp in lastupdate.txt');
    const s = m[1];
    latestMs = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
  } catch (err) {
    console.error(`[conflicts] could not read lastupdate.txt — ${(err as Error).message}`);
    process.exit(1);
  }

  const tmp = mkdtempSync(join(tmpdir(), 'ww3-gdelt-'));
  const clusters = new Map<string, Cluster>();
  let ok = 0;
  try {
    for (let i = 0; i < WINDOWS; i++) {
      const stamp = stampFor(latestMs - i * STEP_MS);
      try {
        const csv = await fetchExportCsv(stamp, tmp);
        ingest(csv, clusters);
        ok++;
      } catch (err) {
        console.log(`[conflicts] skip ${stamp}: ${(err as Error).message.slice(0, 60)}`);
      }
      await sleep(POLITE_MS);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  if (ok === 0) {
    console.error('[conflicts] no GDELT windows fetched — aborting.');
    process.exit(1);
  }

  const events: ConflictEvent[] = [...clusters.values()]
    .filter((c) => !isHubCoverage(c))
    .sort((a, b) => b.wscore - a.wscore)
    .slice(0, TOP_N)
    .map((c) => ({
      lat: Number(c.lat.toFixed(3)),
      lon: Number(c.lon.toFixed(3)),
      root: dominantRoot(c.roots),
      place: c.place.replace(/\s+/g, ' ').trim().slice(0, 60),
      country: c.country,
      mentions: c.mentions,
      events: c.events,
      tone: Number((c.toneSum / c.events).toFixed(1)),
    }));

  const dataset: ConflictDataset = {
    updatedAt: new Date().toISOString(),
    source: 'https://www.gdeltproject.org/ (Events 2.0, material conflict)',
    windowHours: Math.round((WINDOWS * STEP_MS) / 3600_000),
    events,
  };
  writeFileSync(OUT_PATH, JSON.stringify(dataset, null, 2) + '\n');
  console.log(
    `[conflicts] ${ok}/${WINDOWS} windows · ${clusters.size} clusters → kept ${events.length} → ${OUT_PATH}`,
  );

  // Sanity: the strongest few flashpoints.
  for (const e of events.slice(0, 6)) {
    console.log(`  ${e.place || '(unnamed)'} [${e.country}] root=${e.root} · ${e.mentions} mentions / ${e.events} ev`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[conflicts] fatal:', err);
  process.exit(1);
});
