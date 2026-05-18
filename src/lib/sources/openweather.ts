import type { DataSource } from '../types';
import { fetchJson } from '../http';
import { piecewise as pw, reading } from '../scoring';

interface OwmWeatherResponse {
  cod: number;
  message?: string;
  weather: Array<{ id: number; main: string; description: string }>;
  main: { temp: number; humidity: number; pressure: number };
  wind: { speed: number; deg?: number };
  clouds: { all: number };
  rain?: { '1h'?: number; '3h'?: number };
  snow?: { '1h'?: number; '3h'?: number };
  visibility?: number;
  name: string;
  sys: { country: string; sunrise: number; sunset: number };
  dt: number;
}

/**
 * Weather over active conflict / front-line zones. Military operations are
 * historically much more frequent in "attack-favorable" weather: clear skies,
 * low wind, dry ground, decent visibility.
 *
 * For each watchpoint city we compute a per-city "attack window" score, then
 * average across watchpoints. The OWM free-tier "current weather" endpoint is
 * plenty for this — one call per watchpoint, refreshed every 2 hours.
 */
const WATCHPOINTS = [
  // Active war / front-line cities — kept short to stay well inside OWM's
  // free quota (60 calls/min, 1M/month) and to be meaningful only over
  // contested geographies.
  { name: 'Kyiv', country: 'UA', lat: 50.4501, lng: 30.5234 },
  { name: 'Kharkiv', country: 'UA', lat: 49.9935, lng: 36.2304 },
  { name: 'Gaza', country: 'PS', lat: 31.5017, lng: 34.4668 },
  { name: 'Tel Aviv', country: 'IL', lat: 32.0853, lng: 34.7818 },
  { name: 'Beirut', country: 'LB', lat: 33.8938, lng: 35.5018 },
  { name: 'Sanaa', country: 'YE', lat: 15.3694, lng: 44.191 },
  { name: 'Khartoum', country: 'SD', lat: 15.5007, lng: 32.5599 },
  { name: 'Damascus', country: 'SY', lat: 33.5138, lng: 36.2765 },
];

function attackFavorability(w: OwmWeatherResponse): number {
  // 0..100: how favourable is this snapshot for offensive operations?
  // Clear skies, low wind, no precip, decent visibility → high score.
  const clouds = w.clouds?.all ?? 0; // 0..100
  const wind = w.wind?.speed ?? 0;   // m/s
  const rain = (w.rain?.['1h'] ?? w.rain?.['3h'] ?? 0) + (w.snow?.['1h'] ?? w.snow?.['3h'] ?? 0);
  const visKm = (w.visibility ?? 10000) / 1000; // metres → km

  const clearScore = pw(clouds, [
    [0, 100],
    [30, 80],
    [60, 50],
    [85, 25],
    [100, 0],
  ]);
  const windScore = pw(wind, [
    [0, 100],
    [3, 80],
    [7, 50],
    [12, 20],
    [20, 0],
  ]);
  const dryScore = pw(rain, [
    [0, 100],
    [0.5, 60],
    [2, 25],
    [6, 0],
  ]);
  const visScore = pw(visKm, [
    [1, 0],
    [4, 40],
    [8, 80],
    [10, 100],
  ]);
  return 0.35 * clearScore + 0.25 * windScore + 0.25 * dryScore + 0.15 * visScore;
}

export const openWeatherSource: DataSource = {
  id: 'openweather-conflict-zones',
  name: 'Conflict-Zone Attack Weather',
  description:
    'Real-time weather over active conflict / front-line cities (Kyiv, Kharkiv, Gaza, Tel Aviv, Beirut, Sanaa, Khartoum, Damascus) scored for "attack-favourable" conditions: clear, dry, low wind, decent visibility.',
  provider: 'OpenWeatherMap',
  providerUrl: 'https://openweathermap.org/',
  category: 'sentiment',
  weight: 3,
  refreshIntervalSec: 60 * 60 * 2,
  unit: 'fav index 0..100',
  scoringExplanation:
    'Average favourability across watchpoints. >60 means most conflict zones have weather conducive to operations right now.',
  async fetch() {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) {
      throw new Error('OPENWEATHER_API_KEY not set. Free key at https://home.openweathermap.org/api_keys');
    }

    const samples: Array<{ name: string; score: number; weather: string }> = [];
    const failures: string[] = [];
    for (const wp of WATCHPOINTS) {
      try {
        const w = await fetchJson<OwmWeatherResponse>(
          `https://api.openweathermap.org/data/2.5/weather?lat=${wp.lat}&lon=${wp.lng}` +
            `&units=metric&appid=${encodeURIComponent(apiKey)}`,
        );
        if (w.cod && Number(w.cod) !== 200) {
          throw new Error(`OWM ${w.cod}: ${w.message ?? 'unknown'}`);
        }
        samples.push({
          name: wp.name,
          score: attackFavorability(w),
          weather: w.weather?.[0]?.main ?? '?',
        });
      } catch (err) {
        failures.push(`${wp.name}: ${(err as Error).message}`);
      }
    }
    if (samples.length === 0) {
      throw new Error(
        `All OWM watchpoints failed (likely key not yet activated): ${failures[0] ?? 'unknown'}`,
      );
    }
    const avg = samples.reduce((s, x) => s + x.score, 0) / samples.length;
    const score = avg; // already 0..100
    const top = [...samples].sort((a, b) => b.score - a.score).slice(0, 3);
    return reading({
      sourceId: openWeatherSource.id,
      raw: Number(avg.toFixed(1)),
      rawUnit: 'fav 0..100',
      score,
      rationale:
        `Avg attack-favourable index ${avg.toFixed(1)} across ${samples.length} conflict cities. ` +
        `Top: ${top.map((t) => `${t.name} ${t.score.toFixed(0)} (${t.weather})`).join(', ')}.`,
      meta: { samples, failures },
    });
  },
};
