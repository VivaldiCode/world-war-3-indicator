import type { DataSource } from '../types';
import { fetchJson } from '../http';
import { piecewise, reading } from '../scoring';

interface N2YoAboveResponse {
  info: {
    category: string;
    transactionscount: number;
    satcount: number;
  };
  above: Array<{
    satid: number;
    satname: string;
    intDesignator: string;
    launchDate: string;
    satlat: number;
    satlng: number;
    satalt: number;
  }>;
}

/**
 * Watchpoints — capital cities of nuclear-armed / front-line states. More
 * military / spy satellites visible overhead = more active surveillance
 * tasking. We sum the counts across all watchpoints and divide by the number
 * of watchpoints to get an average "eyes-overhead" intensity.
 *
 * Category 30 = Military on n2yo.com.
 */
const WATCHPOINTS = [
  { name: 'Washington DC', lat: 38.9072, lng: -77.0369 },
  { name: 'Moscow', lat: 55.7558, lng: 37.6173 },
  { name: 'Beijing', lat: 39.9042, lng: 116.4074 },
  { name: 'Kyiv', lat: 50.4501, lng: 30.5234 },
  { name: 'Tel Aviv', lat: 32.0853, lng: 34.7818 },
  { name: 'Tehran', lat: 35.6892, lng: 51.389 },
  { name: 'New Delhi', lat: 28.6139, lng: 77.209 },
  { name: 'Pyongyang', lat: 39.0392, lng: 125.7625 },
];
const SEARCH_RADIUS_DEG = 70;
const CATEGORY_MILITARY = 30;

export const n2yoSatellitesSource: DataSource = {
  id: 'n2yo-military-sats',
  name: 'Military Satellites Overhead',
  description:
    'Count of military / surveillance satellites currently passing within ~70° of nuclear-armed and front-line state capitals (Washington, Moscow, Beijing, Kyiv, Tel Aviv, Tehran, New Delhi, Pyongyang).',
  provider: 'n2yo.com',
  providerUrl: 'https://www.n2yo.com/',
  category: 'military',
  weight: 4,
  refreshIntervalSec: 60 * 60 * 6,
  unit: 'sats avg/watchpoint',
  scoringExplanation:
    'Score scales with average military satellites overhead per watchpoint. 50 avg → 30. 80 avg → 60. 120 avg → red.',
  async fetch() {
    const apiKey = process.env.N2YO_API_KEY;
    if (!apiKey) {
      throw new Error('N2YO_API_KEY not set. Free key at https://www.n2yo.com/login/');
    }

    // Pick up to 3 watchpoints per crawl to stay friendly to n2yo's free tier.
    // We rotate via a deterministic timestamp-based stride so we eventually
    // touch all watchpoints in steady state.
    const stride = Math.floor(Date.now() / (60 * 60 * 1000)) % WATCHPOINTS.length;
    const picks = [0, 1, 2].map((i) => WATCHPOINTS[(stride + i) % WATCHPOINTS.length]);

    const perPoint: Array<{ name: string; count: number }> = [];
    for (const wp of picks) {
      const url =
        `https://api.n2yo.com/rest/v1/satellite/above/${wp.lat}/${wp.lng}/0/${SEARCH_RADIUS_DEG}/${CATEGORY_MILITARY}` +
        `/?apiKey=${encodeURIComponent(apiKey)}`;
      const resp = await fetchJson<N2YoAboveResponse>(url);
      perPoint.push({ name: wp.name, count: resp.info?.satcount ?? 0 });
    }
    const avg = perPoint.reduce((s, p) => s + p.count, 0) / perPoint.length;
    const score = piecewise(avg, [
      [20, 0],
      [40, 25],
      [60, 50],
      [90, 75],
      [140, 100],
    ]);
    const breakdown = perPoint
      .map((p) => `${p.name}: ${p.count}`)
      .join(', ');
    return reading({
      sourceId: n2yoSatellitesSource.id,
      raw: Number(avg.toFixed(1)),
      rawUnit: 'sats avg',
      score,
      rationale: `Military sats overhead — ${breakdown}. Avg ${avg.toFixed(1)}.`,
      meta: { perPoint, sampledWatchpoints: picks.map((w) => w.name) },
    });
  },
};
