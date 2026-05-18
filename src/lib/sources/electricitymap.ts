import type { DataSource } from '../types';
import { fetchJson } from '../http';
import { piecewise, reading } from '../scoring';

interface PowerBreakdownResponse {
  zone: string;
  datetime: string;
  fossilFreePercentage: number;
  renewablePercentage: number;
  powerProductionBreakdown: Record<string, number>;
  powerConsumptionBreakdown?: Record<string, number>;
  powerImportTotal?: number;
  powerExportTotal?: number;
  isEstimated?: boolean;
}

interface CarbonIntensityResponse {
  zone: string;
  carbonIntensity: number;
  datetime: string;
  isEstimated?: boolean;
}

/**
 * Electricity grid stress — proxy via fossil-fuel reliance. A grid swinging
 * toward fossil generation often correlates with renewable curtailment from
 * weather or, in stressed periods, with emergency dispatch.
 *
 * The provided ElectricityMaps token is scoped to Portugal (PT). Set the
 * ELECTRICITYMAP_ZONE env var to override if you have a wider-scoped token.
 */
export const electricityMapsSource: DataSource = {
  id: 'electricity-grid-stress',
  name: 'European Grid — Fossil Reliance',
  description:
    'Live share of fossil fuels in Portugal\'s power mix (proxy for European grid stress). Sustained spikes signal energy-system pressure that historically precedes geopolitical instability.',
  provider: 'Electricity Maps',
  providerUrl: 'https://app.electricitymaps.com/map/live/fifteen_minutes',
  category: 'markets',
  weight: 3,
  refreshIntervalSec: 60 * 30,
  unit: '% fossil',
  scoringExplanation:
    '<15% fossil → calm; 30% → elevated; 50%+ → red. Combined with carbon intensity weight (gCO2/kWh).',
  async fetch() {
    const token = process.env.ELECTRICITYMAP_TOKEN;
    const zone = process.env.ELECTRICITYMAP_ZONE ?? 'PT';
    if (!token) {
      throw new Error('ELECTRICITYMAP_TOKEN not set. Free key at https://app.electricitymaps.com/');
    }

    const headers = { 'auth-token': token };
    const breakdown = await fetchJson<PowerBreakdownResponse>(
      `https://api.electricitymap.org/v3/power-breakdown/latest?zone=${zone}`,
      { headers },
    );
    const carbon = await fetchJson<CarbonIntensityResponse>(
      `https://api.electricitymap.org/v3/carbon-intensity/latest?zone=${zone}`,
      { headers },
    );
    const fossilFree = breakdown.fossilFreePercentage ?? 100;
    const fossilPct = Math.max(0, Math.min(100, 100 - fossilFree));

    const fossilScore = piecewise(fossilPct, [
      [5, 0],
      [15, 25],
      [30, 50],
      [50, 80],
      [75, 100],
    ]);
    const carbonScore = piecewise(carbon.carbonIntensity ?? 0, [
      [50, 0],
      [150, 25],
      [300, 50],
      [500, 80],
      [800, 100],
    ]);
    const score = 0.65 * fossilScore + 0.35 * carbonScore;
    return reading({
      sourceId: electricityMapsSource.id,
      raw: Number(fossilPct.toFixed(1)),
      rawUnit: '% fossil',
      score,
      rationale:
        `${zone} grid: ${fossilPct.toFixed(1)}% fossil, ${carbon.carbonIntensity?.toFixed(0) ?? 'n/a'} gCO2/kWh. ` +
        `Fossil→${fossilScore.toFixed(0)}, carbon→${carbonScore.toFixed(0)}.`,
      meta: {
        zone,
        carbonIntensity: carbon.carbonIntensity,
        fossilFreePercentage: fossilFree,
        renewablePercentage: breakdown.renewablePercentage,
        isEstimated: breakdown.isEstimated,
      },
    });
  },
};
