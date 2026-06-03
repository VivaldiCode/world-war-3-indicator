#!/usr/bin/env tsx
/**
 * Offline overseas-deployments pipeline. Reads the Wikipedia "List of countries
 * with overseas military bases" page, slices it into per-deploying-country
 * sections, and asks the local Ollama model to turn each messy section into a
 * clean list of foreign hosts `{to, troops, note}`. Output is a single
 * map-keyed JSON blob (`src/data/deployments.json`) the live site reads at
 * request time. Production never runs this — it runs on the dev machine and the
 * JSON is committed.
 *
 *   npm run deployments           # no-op if the JSON is < 24h old
 *   npm run deployments -- --force  # always re-fetch
 *
 * Unlike the military tables, this page is mostly prose + irregular tables, so
 * Ollama does the heavy lifting (honoring "usar o ollama no mac"). Everything
 * the model returns is re-grounded: host names must resolve to a canonical
 * topojson country, troop counts are dropped unless sane, and self-references
 * are removed.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { normalizeCountry } from '../src/lib/countryNames';
import { ollamaReachable, ollamaGenerateJSON } from '../src/lib/ollama';
import type { Deployment, DeploymentDataset } from '../src/lib/deployments';

const PAGE_URL = 'https://en.wikipedia.org/wiki/List_of_countries_with_overseas_military_bases';
const OUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/deployments.json');
const DAY_MS = 24 * 60 * 60 * 1000;
const UA = 'ww3-indicator-bot/0.1 (+https://github.com/VivaldiCode/world-war-3-indicator)';

const MAX_BLOB = 16000; // chars per section fed to Ollama
const MAX_TROOPS = 500_000; // discard absurd figures
const TERMINAL_IDS = new Set(['See_also', 'Notes', 'References', 'Further_reading', 'External_links']);

async function fetchHTML(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

interface Heading {
  id: string;
  idx: number;
  /** Canonical country name if this heading is a deploying country, else null. */
  from: string | null;
}

/** Every `<h2>`/`<h3>`/`<h4>` with an id, in document order. */
function findHeadings(html: string): Heading[] {
  const re = /<h[234]\b[^>]*\bid="([^"]+)"/g;
  const out: Heading[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const id = m[1];
    const text = id.replace(/_/g, ' ');
    out.push({ id, idx: m.index, from: normalizeCountry(text) });
  }
  return out;
}

/**
 * For a deploying-country heading, the section runs until the next deploying
 * country OR a terminal section (continent sub-headings in between stay).
 */
function sectionSlice(html: string, headings: Heading[], i: number): string {
  const start = headings[i].idx;
  let end = html.length;
  for (let j = i + 1; j < headings.length; j++) {
    if (headings[j].from || TERMINAL_IDS.has(headings[j].id)) {
      end = headings[j].idx;
      break;
    }
  }
  return html.slice(start, end);
}

/** Dense, model-friendly text: table rows first, then any prose, capped. */
function sectionText(sliceHtml: string): string {
  const $ = cheerio.load(sliceHtml);
  $('style, script, sup.reference').remove();
  const lines: string[] = [];

  $('table.wikitable tr').each((_, tr) => {
    const cells = $(tr)
      .find('td, th')
      .toArray()
      .map((c) => $(c).text().replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (cells.length) lines.push(cells.join(' — '));
  });

  // Fall back to (or supplement with) paragraph + list text.
  $('p, li').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t.length > 20) lines.push(t);
  });

  return lines.join('\n').slice(0, MAX_BLOB);
}

interface RawItem {
  to?: unknown;
  troops?: unknown;
  note?: unknown;
}

async function extractSection(from: string, text: string): Promise<Deployment[]> {
  const prompt = [
    `You extract a country's OVERSEAS military presence from Wikipedia text.`,
    `The deploying country is: "${from}".`,
    `From the text below, list EVERY foreign host country where ${from} maintains`,
    `a military base, installation, or deployed personnel.`,
    ``,
    `Return ONLY a JSON object of this exact shape (the "hosts" array usually has`,
    `several items):`,
    `  {"hosts": [`,
    `    {"to": "Germany", "troops": 35000, "note": "Ramstein Air Base"},`,
    `    {"to": "Djibouti", "troops": null, "note": "naval base"}`,
    `  ]}`,
    ``,
    `Rules:`,
    `- Include every host country named in the text. Only ones present — never invent.`,
    `- "troops" = an integer ONLY if a personnel figure is explicitly stated for that`,
    `  host; otherwise null. Never estimate.`,
    `- "note" = short base name or location, max 8 words.`,
    `- Exclude "${from}" itself and generic regions (Africa, Europe, Asia, Americas, Oceania).`,
    `- One element per host country.`,
    ``,
    `TEXT:`,
    text,
  ].join('\n');

  let items: RawItem[];
  try {
    const ans = await ollamaGenerateJSON<{ hosts?: RawItem[] } | RawItem[]>(prompt, {
      numCtx: 16384,
    });
    items = Array.isArray(ans) ? ans : Array.isArray(ans?.hosts) ? ans.hosts : [];
  } catch (err) {
    console.log(`[deployments] ${from}: ollama failed — ${(err as Error).message.slice(0, 120)}`);
    return [];
  }

  const out = new Map<string, Deployment>();
  for (const it of items) {
    const rawTo = typeof it.to === 'string' ? it.to : '';
    const to = normalizeCountry(rawTo);
    if (!to || to === from) continue;

    let troops: number | undefined;
    const tNum = typeof it.troops === 'number' ? it.troops : Number(it.troops);
    if (Number.isFinite(tNum) && tNum > 0 && tNum <= MAX_TROOPS) troops = Math.round(tNum);

    let note: string | undefined;
    if (typeof it.note === 'string') {
      const n = it.note.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
      if (n && n.toLowerCase() !== 'null') note = n.slice(0, 80);
    }
    // Drop former/closed presences — the page lists a few historical ones.
    if (note && /\b(closed|former|disused|abandoned|ex-)\b/i.test(note)) continue;

    const prev = out.get(to);
    if (prev) {
      if (troops !== undefined && (prev.troops === undefined || troops > prev.troops)) prev.troops = troops;
      if (!prev.note && note) prev.note = note;
    } else {
      out.set(to, { from, to, ...(troops !== undefined && { troops }), ...(note && { note }) });
    }
  }
  return [...out.values()];
}

async function main() {
  const force = process.argv.includes('--force');

  if (!force && existsSync(OUT_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(OUT_PATH, 'utf8')) as DeploymentDataset;
      const age = Date.now() - new Date(prev.updatedAt).getTime();
      if (Number.isFinite(age) && age < DAY_MS) {
        console.log(`[deployments] up to date (${(age / 3600_000).toFixed(1)}h old). Use --force.`);
        process.exit(0);
      }
    } catch {
      /* unreadable — rebuild */
    }
  }

  if (!(await ollamaReachable())) {
    console.error('[deployments] Ollama unreachable — start it (ollama serve) and retry.');
    process.exit(1);
  }

  const html = await fetchHTML(PAGE_URL);
  const headings = findHeadings(html);
  const deployers = headings
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h.from);
  console.log(`[deployments] ${deployers.length} deploying-country sections found`);

  const all: Deployment[] = [];
  for (const { h, i } of deployers) {
    const from = h.from as string;
    const text = sectionText(sectionSlice(html, headings, i));
    if (!text) {
      console.log(`[deployments] ${from}: empty section, skipped`);
      continue;
    }
    const found = await extractSection(from, text);
    console.log(`[deployments] ${from}: ${found.length} hosts`);
    all.push(...found);
  }

  // Stable order: by deployer, then host.
  all.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  const dataset: DeploymentDataset = {
    updatedAt: new Date().toISOString(),
    source: PAGE_URL,
    deployments: all,
  };
  writeFileSync(OUT_PATH, JSON.stringify(dataset, null, 2) + '\n');
  console.log(`[deployments] wrote ${all.length} deployments → ${OUT_PATH}`);

  // Sanity block — eyeball against known presences before trusting the run.
  const show = (from: string, to: string) => {
    const d = all.find((x) => x.from === from && x.to === to);
    console.log(`  ${from} → ${to}: ${d ? `troops=${d.troops ?? '—'} (${d.note ?? ''})` : '(missing)'}`);
  };
  show('United States of America', 'Germany');
  show('United States of America', 'Japan');
  show('United States of America', 'South Korea');
  show('Russia', 'Syria');
  show('France', 'Djibouti');
  process.exit(0);
}

main().catch((err) => {
  console.error('[deployments] fatal:', err);
  process.exit(1);
});
