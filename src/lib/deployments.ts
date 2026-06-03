/**
 * Live-path loader for the overseas-deployments dataset produced offline by
 * `scripts/deployments.ts` (→ src/data/deployments.json). Pure data + a small
 * palette for the deploying powers; no network, no Ollama. The forces map draws
 * an arc from each deploying country to every foreign host it maintains forces
 * in.
 */
import data from '@/data/deployments.json';

/** One foreign military presence: `from` keeps forces in `to`. */
export interface Deployment {
  /** Canonical (topojson) name of the deploying country. */
  from: string;
  /** Canonical (topojson) name of the host country. */
  to: string;
  /** Personnel, only when an explicit figure was stated in the source. */
  troops?: number;
  /** Short base name / location, for context. */
  note?: string;
}

export interface DeploymentDataset {
  updatedAt: string;
  source: string;
  deployments: Deployment[];
}

export const DEPLOYMENTS = data as DeploymentDataset;

/**
 * Recognisable colours for the major expeditionary powers; the big three are
 * pinned to the same hues the satellite layer uses (USA blue, Russia red, China
 * gold) so the two overlays read consistently. Anything not listed falls back
 * to DEFAULT_DEPLOYER_COLOR.
 */
export const DEPLOYER_COLORS: Record<string, string> = {
  'United States of America': '#2f6fb0',
  Russia: '#c0392b',
  China: '#e0a526',
  France: '#8e5bbf',
  'United Kingdom': '#3fb8cf',
  Turkey: '#d2691e',
  India: '#4f9d69',
  Germany: '#7c8a9c',
  Japan: '#d14d72',
  Italy: '#5b8c5a',
  Australia: '#c79a3a',
  Greece: '#4a6fa5',
  Pakistan: '#2e8b74',
  Singapore: '#b5651d',
  Israel: '#9aa0a6',
  Bangladesh: '#6b9b37',
  'United Arab Emirates': '#a8843f',
};

export const DEFAULT_DEPLOYER_COLOR = '#8a7a55';

export function deployerColor(name: string): string {
  return DEPLOYER_COLORS[name] ?? DEFAULT_DEPLOYER_COLOR;
}

/** Deploying countries present in the data, ordered by number of host arcs. */
export function deployersPresent(deps: Deployment[]): string[] {
  const count = new Map<string, number>();
  for (const d of deps) count.set(d.from, (count.get(d.from) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}
