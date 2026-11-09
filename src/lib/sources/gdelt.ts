import type { DataSource } from '../types';
import { piecewise, reading } from '../scoring';

interface GdeltToneTimeline {
  timeline: Array<{
    series: string;
    data: Array<{ date: string; value: number }>;
  }>;
}

const GDELT_ATTEMPTS = 3;
/** GDELT asks for at most one request every 5 seconds per client. */
const GDELT_BASE_WAIT_MS = 6_000;

/**
 * GDELT answers 429 (or 200 with a "limit requests" text) when the shared
 * egress IP is over its quota. Wait and retry a couple of times, honouring
 * Retry-After, before giving up: the engine then keeps the last good reading.
 */
export async function fetchWithBackoff(
  url: string,
  doFetch: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<string> {
  let lastError = 'unknown';
  for (let attempt = 1; attempt <= GDELT_ATTEMPTS; attempt++) {
    const res = await doFetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WW3IndicatorBot/0.1)', Accept: 'application/json' },
      cache: 'no-store',
    });
    const body = res.ok ? await res.text() : '';
    const limited = res.status === 429 || (res.ok && /limit requests/i.test(body));
    if (res.ok && !limited) return body;
    lastError = limited ? `GDELT rate limit (attempt ${attempt}/${GDELT_ATTEMPTS})` : `HTTP ${res.status} ${res.statusText} fetching ${url}`;
    if (!limited && res.status < 500) break; // 4xx other than 429 will not get better
    if (attempt < GDELT_ATTEMPTS) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : GDELT_BASE_WAIT_MS * attempt;
      await sleep(waitMs);
    }
  }
  throw new Error(lastError);
}

/**
 * GDELT 2.0 — Global Database of Events, Language & Tone.
 * Free, no API key. We query the DOC API for the *average tone* of articles
 * mentioning "war" globally over the last 24 hours. More negative = more
 * negative narrative = higher score.
 */
export const gdeltToneSource: DataSource = {
  id: 'gdelt-war-tone',
  name: 'GDELT — Global "War" News Tone',
  description:
    'Average emotional tone (−10 to +10) of worldwide news articles mentioning "war" or "conflict" in the last 24 hours. More negative = darker narrative.',
  provider: 'GDELT 2.0',
  providerUrl: 'https://www.gdeltproject.org/',
  category: 'sentiment',
  weight: 7,
  refreshIntervalSec: 60 * 60,
  unit: 'tone',
  scoringExplanation:
    'Tone scale is roughly −10..+10. Tone < −5 means extremely negative coverage. Mapping: 0 → 25, −3 → 50, −6 → 80, −10 → 100.',
  async fetch() {
    // tonechart timeline for "war OR conflict" globally, 24h
    const url =
      'https://api.gdeltproject.org/api/v2/doc/doc?' +
      'query=(war%20OR%20conflict)%20sourcelang:eng&mode=timelinetone&format=json&timespan=24h';
    // GDELT returns 200 with a "limit requests" plaintext body when rate-limited.
    // Fall back to fetchText so we can detect that before JSON.parse fails.
    const body = await fetchWithBackoff(url);
    let json: GdeltToneTimeline;
    try {
      json = JSON.parse(body) as GdeltToneTimeline;
    } catch {
      throw new Error(`GDELT returned non-JSON: ${body.slice(0, 80)}`);
    }
    const series = json.timeline?.[0]?.data ?? [];
    if (series.length === 0) {
      throw new Error('GDELT returned an empty timeline');
    }
    const recent = series.slice(-24); // last 24 hourly buckets
    const avg = recent.reduce((s, p) => s + p.value, 0) / recent.length;
    const score = piecewise(avg, [
      [-10, 100],
      [-6, 80],
      [-3, 50],
      [0, 25],
      [3, 0],
    ]);
    return reading({
      sourceId: gdeltToneSource.id,
      raw: Number(avg.toFixed(2)),
      rawUnit: 'tone',
      score,
      rationale: `Avg news tone for war/conflict over last 24h: ${avg.toFixed(2)}. ${avg < -5 ? 'Very dark' : avg < -3 ? 'Negative' : 'Mixed'} narrative.`,
      meta: { samples: recent.length, latest: series[series.length - 1] },
    });
  },
};
