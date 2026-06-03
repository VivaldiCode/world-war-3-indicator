/**
 * Live military-aircraft proxy. Fetches the adsb.fi community feed (airplanes.live
 * as a fallback) of military-tagged contacts, trims each to the few fields the
 * map needs, tags a broad role, and caches the result briefly so a burst of
 * viewers collapses to at most one upstream hit per TTL. Both feeds share the
 * same readsb JSON shape (`{ ac: [...] }`); the heavy `mil` endpoint is global.
 *
 * Real-time by nature, so this is the one data source that is NOT a committed,
 * once-a-day JSON — the daily-refresh rule covers the Wikipedia scrapes, not a
 * live overlay. CORS is open and there is no auth, like the rest of the API.
 */
import { NextResponse } from 'next/server';
import { classifyAircraft, type Flight } from '@/lib/flights';

export const dynamic = 'force-dynamic';

const UA = 'ww3-indicator-bot/0.1 (+https://github.com/VivaldiCode/world-war-3-indicator)';
const FEEDS = ['https://opendata.adsb.fi/api/v2/mil', 'https://api.airplanes.live/v2/mil'];
const TTL_MS = 20_000; // serve a cached batch for this long between upstream hits
const TIMEOUT_MS = 8_000;

const CORS = {
  'Cache-Control': 'no-store, max-age=0',
  'Access-Control-Allow-Origin': '*',
};

interface RawAc {
  hex?: string;
  flight?: string;
  t?: string;
  r?: string;
  desc?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | string;
  gs?: number;
  track?: number;
}

interface Payload {
  updatedAt: string;
  source: string;
  count: number;
  aircraft: Flight[];
}

let cache: { at: number; payload: Payload } | null = null;

async function fetchFeed(url: string): Promise<RawAc[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const json = (await res.json()) as { ac?: RawAc[] };
    return Array.isArray(json.ac) ? json.ac : [];
  } finally {
    clearTimeout(timer);
  }
}

function normalize(raw: RawAc[]): Flight[] {
  const out: Flight[] = [];
  const seen = new Set<string>();
  for (const a of raw) {
    if (typeof a.hex !== 'string' || seen.has(a.hex)) continue;
    if (typeof a.lat !== 'number' || typeof a.lon !== 'number') continue; // need a fix to plot
    seen.add(a.hex);
    const type = typeof a.t === 'string' ? a.t : null;
    const desc = typeof a.desc === 'string' ? a.desc : null;
    out.push({
      hex: a.hex,
      flight: typeof a.flight === 'string' && a.flight.trim() ? a.flight.trim() : null,
      type,
      reg: typeof a.r === 'string' ? a.r : null,
      desc,
      lat: a.lat,
      lon: a.lon,
      alt: typeof a.alt_baro === 'number' ? a.alt_baro : null, // "ground" → null
      gs: typeof a.gs === 'number' ? a.gs : null,
      track: typeof a.track === 'number' ? a.track : null,
      cat: classifyAircraft(type, desc),
    });
  }
  return out;
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) {
    return NextResponse.json(cache.payload, { headers: CORS });
  }

  let raw: RawAc[] = [];
  let source = '';
  for (const url of FEEDS) {
    try {
      raw = await fetchFeed(url);
      source = url;
      if (raw.length) break;
    } catch {
      /* try the next feed */
    }
  }

  const aircraft = normalize(raw);
  // Both feeds unreachable this round — keep serving the last good batch.
  if (aircraft.length === 0 && cache) {
    return NextResponse.json(cache.payload, { headers: CORS });
  }

  const payload: Payload = {
    updatedAt: new Date().toISOString(),
    source,
    count: aircraft.length,
    aircraft,
  };
  cache = { at: now, payload };
  return NextResponse.json(payload, { headers: CORS });
}
