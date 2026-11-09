import type { DataSource } from '../types';
import { piecewise, reading } from '../scoring';

/**
 * UCDP GED Candidate events (Uppsala Conflict Data Program), the near-real-time
 * georeferenced conflict-event feed, monthly releases. Needs an API token
 * (x-ucdp-access-token) that UCDP issues on request: set UCDP_API_TOKEN, and the
 * source registers itself; without it the source does not exist. HOMEL-475.
 *
 * It replaces the role ACLED was meant to play (ACLED's event API needs a level
 * the account does not have). Reports fatalities ("best" estimate) per 30 days
 * over the newest ~90 days that UCDP has published (release lag is ~5 weeks).
 */
const BASE = 'https://ucdpapi.pcr.uu.se/api/gedevents';
const WINDOW_DAYS = 90;
const MAX_PAGES = 60; // safety cap: ~60k events

interface GedEvent {
  date_end: string;
  best: number;
}
interface GedPage {
  TotalCount?: number;
  TotalPages?: number;
  NextPageUrl?: string | null;
  Result?: GedEvent[];
}

/** Candidate versions are YY.0.M (monthly). Try the newest month first, then step back. */
export function candidateVersions(now: Date, count = 4): string[] {
  const out: string[] = [];
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth() + 1;
  for (let i = 0; i < count; i++) {
    out.push(`${String(y).slice(2)}.0.${m}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export function summarise(events: GedEvent[], now: Date): { events: number; deaths: number; spanDays: number; deathsPer30d: number; newest: string | null } {
  const dates = events.map((e) => Date.parse(e.date_end)).filter((t) => Number.isFinite(t));
  if (dates.length === 0) return { events: 0, deaths: 0, spanDays: 0, deathsPer30d: 0, newest: null };
  const newest = Math.max(...dates);
  const windowStart = newest - WINDOW_DAYS * 86400_000;
  const inWindow = events.filter((e) => Date.parse(e.date_end) >= windowStart);
  const deaths = inWindow.reduce((s, e) => s + (Number(e.best) || 0), 0);
  const spanDays = Math.max(1, Math.min(WINDOW_DAYS, (newest - Math.min(...dates)) / 86400_000));
  return { events: inWindow.length, deaths, spanDays, deathsPer30d: (deaths / spanDays) * 30, newest: new Date(newest).toISOString().slice(0, 10) };
}

export function scoreDeathsPer30d(d: number): number {
  return piecewise(d, [[4000, 10], [8000, 35], [12000, 55], [20000, 80], [35000, 100]]);
}

export async function fetchCandidate(
  token: string,
  now = new Date(),
  doFetch: typeof fetch = fetch,
): Promise<{ version: string; events: GedEvent[] }> {
  const headers = { 'x-ucdp-access-token': token, Accept: 'application/json' };
  const start = new Date(now.getTime() - (WINDOW_DAYS + 45) * 86400_000).toISOString().slice(0, 10);
  let lastStatus = 0;
  for (const version of candidateVersions(now)) {
    let url: string | null = `${BASE}/${version}?pagesize=1000&StartDate=${start}`;
    const events: GedEvent[] = [];
    let pages = 0;
    let missing = false;
    while (url && pages < MAX_PAGES) {
      const res: Response = await doFetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(60_000) });
      lastStatus = res.status;
      if (res.status === 401 || res.status === 403) throw new Error(`UCDP token refused (HTTP ${res.status})`);
      if (res.status === 404 || res.status === 400) {
        missing = true; // that monthly release does not exist (yet): try the previous month
        break;
      }
      if (!res.ok) throw new Error(`UCDP HTTP ${res.status}`);
      const page = (await res.json()) as GedPage;
      events.push(...(page.Result ?? []));
      url = page.NextPageUrl ? page.NextPageUrl : null;
      pages++;
    }
    if (missing) continue;
    return { version, events };
  }
  throw new Error(`UCDP: no candidate release found (last HTTP ${lastStatus})`);
}

export const ucdpGedSource: DataSource = {
  id: 'ucdp-ged-candidate',
  name: 'UCDP GED Candidate — Conflict Fatalities',
  description:
    'Fatalities in georeferenced armed-conflict events (UCDP GED Candidate, monthly release) over the newest ~90 days published, normalised to 30 days. Release lag is about 5 weeks.',
  provider: 'UCDP (Uppsala University)',
  providerUrl: 'https://ucdp.uu.se/',
  category: 'conflicts',
  weight: 8,
  refreshIntervalSec: 24 * 3600,
  unit: 'deaths/30d',
  scoringExplanation: 'Best-estimate deaths per 30 days: 4k → 10, 8k → 35, 12k → 55, 20k → 80, 35k+ → 100.',
  enabled: () => Boolean(process.env.UCDP_API_TOKEN),
  async fetch() {
    const token = process.env.UCDP_API_TOKEN;
    if (!token) throw new Error('UCDP_API_TOKEN not set');
    const { version, events } = await fetchCandidate(token);
    const s = summarise(events, new Date());
    if (s.events === 0) throw new Error(`UCDP ${version} returned no events in the window`);
    return reading({
      sourceId: ucdpGedSource.id,
      raw: Math.round(s.deathsPer30d),
      rawUnit: 'deaths/30d',
      score: scoreDeathsPer30d(s.deathsPer30d),
      rationale: `UCDP GED candidate ${version}: ${s.events.toLocaleString()} events, ${s.deaths.toLocaleString()} deaths over ${s.spanDays.toFixed(0)} days up to ${s.newest} (${Math.round(s.deathsPer30d).toLocaleString()}/30d).`,
      meta: { version, events: s.events, deaths: s.deaths, newest: s.newest },
    });
  },
};
