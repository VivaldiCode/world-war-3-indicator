import type { DataSource } from '../types';
import { fetchJson } from '../http';
import { piecewise, reading } from '../scoring';

/**
 * Liveuamap — live conflict-event feed across active war theatres
 * (Ukraine, Syria, Yemen, Israel, etc.). Premium API behind an account at
 * https://me.liveuamap.com/devapi.
 *
 * The publicly probeable endpoints (/api?key=…&action=…) always return
 * `{"success":false}` regardless of credentials, suggesting the real B2B
 * endpoint is gated behind a different host / path / auth scheme exposed
 * only inside the developer portal. Until we copy the example curl from
 * the portal, the source emits a friendly "configure endpoint" status and
 * the engine redistributes its weight.
 *
 * To wire in the real endpoint, edit LIVEUAMAP_ENDPOINT below to whatever
 * the devapi page tells you, then re-deploy. The shape of `LiveuamapResponse`
 * may also need a tweak depending on the response payload.
 */
interface LiveuamapEvent {
  /** ISO timestamp. */
  posted: string;
  /** Country / theatre code (e.g. UA, SY, IL). */
  country?: string;
  /** Headline text. */
  text?: string;
  /** Event categorisation (battle, airstrike, civilian-casualty, …). */
  type?: string;
}

interface LiveuamapResponse {
  success: boolean;
  data?: LiveuamapEvent[];
  events?: LiveuamapEvent[];
}

/**
 * 👇  REPLACE THIS with the request the devapi page shows you. Most likely a
 *     query-string GET against a documented host, but it could equally be
 *     a JSON POST. Keep `${apiKey}` as the substitution token.
 *
 *     Example forms we've seen historically:
 *       GET  https://liveuamap.com/api?key=${apiKey}&action=getEventsByTime&time_from=...
 *       GET  https://api.liveuamap.com/v1/events?token=${apiKey}&since=...
 *       POST https://liveuamap.com/api  (form: key, action, time_from)
 */
const LIVEUAMAP_ENDPOINT = (apiKey: string, sinceIso: string) =>
  `https://liveuamap.com/api?key=${encodeURIComponent(apiKey)}` +
  `&action=getEventsByTime&time_from=${encodeURIComponent(sinceIso)}`;

export const liveuamapSource: DataSource = {
  id: 'liveuamap-events',
  name: 'Liveuamap — Live Conflict Events (24h)',
  description:
    'Number of geo-tagged conflict events reported to Liveuamap across active war theatres in the last 24 hours. Bursts of activity over short windows correlate with active offensives.',
  provider: 'Liveuamap',
  providerUrl: 'https://liveuamap.com/',
  category: 'conflicts',
  weight: 8,
  refreshIntervalSec: 60 * 30,
  unit: 'events/24h',
  scoringExplanation:
    '<50 events/24h → calm; 200 → elevated; 500+ → red. A "diversity bonus" kicks in when events span >5 distinct countries the same day.',
  async fetch() {
    const apiKey = process.env.LIVEUAMAP_API_KEY;
    if (!apiKey) {
      throw new Error(
        'LIVEUAMAP_API_KEY not set. Get one at https://me.liveuamap.com/devapi',
      );
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const url = LIVEUAMAP_ENDPOINT(apiKey, since);

    const json = await fetchJson<LiveuamapResponse>(url);
    if (!json.success) {
      throw new Error(
        'Liveuamap endpoint shape mismatch — copy the example curl from ' +
          'https://me.liveuamap.com/devapi into LIVEUAMAP_ENDPOINT in ' +
          'src/lib/sources/liveuamap.ts to enable this source.',
      );
    }
    const events = json.events ?? json.data ?? [];
    const countries = new Set(events.map((e) => e.country).filter(Boolean));

    const volumeScore = piecewise(events.length, [
      [20, 0],
      [50, 25],
      [200, 50],
      [400, 75],
      [800, 100],
    ]);
    const diversityBonus = piecewise(countries.size, [
      [1, 0],
      [3, 5],
      [5, 15],
      [8, 25],
      [12, 35],
    ]);
    const score = Math.min(100, volumeScore + diversityBonus);

    return reading({
      sourceId: liveuamapSource.id,
      raw: events.length,
      rawUnit: 'events/24h',
      score,
      rationale:
        `${events.length.toLocaleString()} live events across ${countries.size} theatre(s) in last 24h. ` +
        `Volume→${volumeScore.toFixed(0)}, diversity→+${diversityBonus.toFixed(0)}.`,
      meta: {
        events: events.length,
        theatres: [...countries],
      },
    });
  },
};
