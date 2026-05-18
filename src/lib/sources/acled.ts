import type { DataSource } from '../types';
import { fetchJson, fetchText } from '../http';
import { piecewise, reading } from '../scoring';

interface AcledTokenResponse {
  token_type: string;
  expires_in: number;
  access_token: string;
  refresh_token?: string;
}

interface AcledEventRow {
  event_date: string;
  fatalities: string;
  event_type: string;
  country: string;
}

interface AcledReadResponse {
  status: number;
  success: boolean | number;
  count?: number;
  data: AcledEventRow[];
}

// In-memory token cache. The OAuth2 token has a 24h TTL; we refresh ~10
// minutes early so the refresher never sees a 401.
let _token: { value: string; expiresAt: number } | null = null;

async function getAcledToken(username: string, password: string): Promise<string> {
  const now = Date.now();
  if (_token && _token.expiresAt > now + 60_000) return _token.value;
  const body = new URLSearchParams({
    username,
    password,
    client_id: 'acled',
    grant_type: 'password',
  }).toString();
  const res = await fetch('https://acleddata.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`ACLED token endpoint ${res.status}: ${txt.slice(0, 120)}`);
  }
  const json = (await res.json()) as AcledTokenResponse;
  _token = {
    value: json.access_token,
    expiresAt: now + (json.expires_in - 600) * 1000,
  };
  return json.access_token;
}

/**
 * ACLED — Armed Conflict Location & Event Data (https://acleddata.com).
 *
 * Auth flow:
 *   1. POST username/password to /oauth/token → 24h Bearer.
 *   2. GET /api/acled/read with `Authorization: Bearer …`.
 *
 * Heads-up: after registering at acleddata.com/register, a newly created
 * account authenticates fine but data endpoints respond `403 Access denied`
 * until ACLED's team grants the data-read scope (usually 1–2 business days
 * — they email you when it's done). The source returns a friendly "Awaiting
 * ACLED registration" card until that scope arrives.
 */
export const acledConflictsSource: DataSource = {
  id: 'acled-events',
  name: 'ACLED — Political Violence (30d)',
  description:
    'Count of political-violence events (battles, explosions, attacks on civilians) globally in the last 30 days, plus fatality totals. The gold-standard granular conflict dataset.',
  provider: 'ACLED',
  providerUrl: 'https://acleddata.com/',
  category: 'conflicts',
  weight: 10,
  refreshIntervalSec: 60 * 60 * 6,
  unit: 'events/30d',
  scoringExplanation:
    '<3k events → calm; 6k → elevated; 10k+ → red. Fatalities multiplier kicks in above 20k deaths/30d.',
  async fetch() {
    const username = process.env.ACLED_USERNAME ?? process.env.ACLED_EMAIL;
    const password = process.env.ACLED_PASSWORD ?? process.env.ACLED_KEY;
    if (!username || !password) {
      throw new Error(
        'ACLED_USERNAME and ACLED_PASSWORD env vars are required. Register free at https://acleddata.com/register/',
      );
    }
    const token = await getAcledToken(username, password);

    const end = new Date();
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const url =
      `https://acleddata.com/api/acled/read?_format=json` +
      `&event_date=${fmt(start)}|${fmt(end)}&event_date_where=BETWEEN` +
      `&fields=event_date|fatalities|event_type|country&limit=0`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (res.status === 403) {
      // Most common cause is the data-read scope not yet granted to the
      // newly-registered account. Surface it as a user-friendly state.
      throw new Error(
        'ACLED account awaiting approval — data-read scope not yet granted (typically 1-2 business days after registration).',
      );
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ACLED ${res.status}: ${body.slice(0, 120)}`);
    }
    const json = (await res.json()) as AcledReadResponse;
    const rows = json.data ?? [];
    const events = rows.length || json.count || 0;
    const fatalities = rows.reduce((s, r) => s + (Number(r.fatalities) || 0), 0);

    const eventScore = piecewise(events, [
      [1000, 0],
      [3000, 25],
      [6000, 50],
      [10000, 75],
      [16000, 100],
    ]);
    const fatScore = piecewise(fatalities, [
      [1000, 0],
      [5000, 25],
      [12000, 50],
      [25000, 80],
      [50000, 100],
    ]);
    const score = 0.55 * eventScore + 0.45 * fatScore;
    return reading({
      sourceId: acledConflictsSource.id,
      raw: events,
      rawUnit: 'events/30d',
      score,
      rationale: `${events.toLocaleString()} political-violence events, ${fatalities.toLocaleString()} fatalities in last 30 days.`,
      meta: { events, fatalities, windowDays: 30 },
    });
  },
};

// Silence unused-warning when consumed only via reflection elsewhere.
void fetchText;
void fetchJson;
