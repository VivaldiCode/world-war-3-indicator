import type { DataSource } from '../types';
import { fetchJson } from '../http';
import { piecewise, reading } from '../scoring';

interface CfRadarResponse<T> {
  success: boolean;
  result: T;
  errors?: Array<{ code: number; message: string }>;
}

interface L7Timeseries {
  serie_0: {
    timestamps: string[];
    values: string[];
  };
  meta?: unknown;
}

interface L3TopOrigins {
  top_0: Array<{
    originCountryAlpha2: string;
    originCountryName: string;
    value: string;
    rank: number;
  }>;
}

/**
 * Cloudflare Radar — DDoS / L7 attack pressure + geographic concentration.
 *
 * Two signals:
 *   1. L7 attack *trend*: compare the latest hour against the 24h baseline.
 *      A rising attack rate is the relevant signal here, not the absolute %.
 *   2. L3 origin concentration: share of DDoS volume coming from the top-5
 *      source countries (concentrated bursts are characteristic of nation-
 *      state-grade attacks rather than commodity botnets).
 *
 * Auth: free Cloudflare API token with the `radar:read` permission. Set as
 * `CLOUDFLARE_API_TOKEN`.
 */
export const cloudflareRadarSource: DataSource = {
  id: 'cloudflare-radar',
  name: 'Cloudflare Radar — Internet Attacks',
  description:
    'L7 attack-traffic trend (last hour vs 24h baseline) blended with geographic concentration of DDoS source countries. Both signals climb during coordinated cyber escalations.',
  provider: 'Cloudflare Radar',
  providerUrl: 'https://radar.cloudflare.com/',
  category: 'sentiment',
  weight: 6,
  refreshIntervalSec: 60 * 60,
  unit: 'attack trend',
  scoringExplanation:
    'Blends recent vs 24h attack-rate ratio (>1.5× → red) with top-5 origin concentration (>70% of all DDoS volume → red).',
  async fetch() {
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!token) {
      throw new Error(
        'CLOUDFLARE_API_TOKEN not set. Create a free token with the radar:read permission at https://dash.cloudflare.com/profile/api-tokens',
      );
    }
    const headers = { Authorization: `Bearer ${token}` };

    // 1) L7 attack timeseries (24h, 15-min buckets ≈ 96 points)
    let trendRatio: number | null = null;
    let recentVal: number | null = null;
    try {
      const r = await fetchJson<CfRadarResponse<L7Timeseries>>(
        'https://api.cloudflare.com/client/v4/radar/attacks/layer7/timeseries?dateRange=1d&format=json',
        { headers },
      );
      const vals = (r.result?.serie_0?.values ?? []).map(Number).filter(Number.isFinite);
      if (vals.length >= 12) {
        const recent = vals.slice(-6); // last ~1.5h
        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const fullAvg = vals.reduce((a, b) => a + b, 0) / vals.length;
        trendRatio = fullAvg > 0 ? recentAvg / fullAvg : 1;
        recentVal = recentAvg;
      }
    } catch {
      // continue — we still have the concentration signal
    }

    // 2) L3 DDoS top-5 origin concentration (24h)
    let topShare = 0;
    let topCountries: string[] = [];
    try {
      const r = await fetchJson<CfRadarResponse<L3TopOrigins>>(
        'https://api.cloudflare.com/client/v4/radar/attacks/layer3/top/locations/origin?dateRange=1d&limit=5',
        { headers },
      );
      const rows = r.result?.top_0 ?? [];
      topShare = rows.reduce((s, row) => s + Number(row.value || 0), 0);
      topCountries = rows.map((r2) => r2.originCountryAlpha2);
    } catch {
      // leave defaults
    }

    if (trendRatio == null && topShare === 0) {
      throw new Error('Cloudflare Radar returned no usable signals');
    }

    const trendScore =
      trendRatio == null
        ? 50
        : piecewise(trendRatio, [
            [0.5, 0],
            [0.9, 20],
            [1.0, 35],
            [1.2, 55],
            [1.5, 80],
            [2.0, 100],
          ]);
    const concScore = piecewise(topShare, [
      [40, 0],
      [55, 30],
      [65, 55],
      [75, 80],
      [90, 100],
    ]);
    const score = 0.6 * trendScore + 0.4 * concScore;
    return reading({
      sourceId: cloudflareRadarSource.id,
      raw: trendRatio == null ? topShare : Number(trendRatio.toFixed(2)),
      rawUnit: trendRatio == null ? '% top-5 share' : 'recent/24h',
      score,
      rationale:
        (trendRatio == null
          ? 'L7 trend unavailable; '
          : `L7 attacks ${trendRatio.toFixed(2)}× the 24h baseline; `) +
        `top-5 DDoS origins [${topCountries.join(',')}] = ${topShare.toFixed(1)}% of volume.`,
      meta: { trendRatio, recentVal, topShare, topCountries },
    });
  },
};
