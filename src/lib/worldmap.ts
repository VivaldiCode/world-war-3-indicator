import { feature } from 'topojson-client';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import worldData from '@/data/world-110m.json';

export interface CountryShape {
  /** ISO numeric ID, e.g. "840" for USA. */
  id: string;
  /** Common English name from world-atlas. */
  name: string;
  /** SVG `d` path attribute already projected into our 960×500 canvas. */
  d: string;
}

const W = 960;
const H = 500;

// world-atlas v2 ships as a TopoJSON topology with a `countries` object.
// We don't depend on topojson-specification — the run-time shape is fine.
type AnyTopo = Parameters<typeof feature>[0];
type AnyObj = Parameters<typeof feature>[1];

const topology = worldData as unknown as AnyTopo;
const collection = feature(
  topology,
  (topology as { objects: Record<string, AnyObj> }).objects.countries,
) as unknown as {
  features: Array<{
    id?: string | number;
    properties?: { name?: string };
  }>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const projection = geoNaturalEarth1().fitSize([W, H], collection as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pathFn = geoPath(projection) as any;

export const WORLD_VIEWBOX = `0 0 ${W} ${H}`;

/**
 * Pre-projected country paths. Computed once at module load so each request
 * just returns a tiny string array.
 */
export const COUNTRIES: CountryShape[] = collection.features
  .map((f) => {
    const d = pathFn(f) ?? '';
    return {
      id: String(f.id ?? ''),
      name: f.properties?.name ?? 'Unknown',
      d,
    };
  })
  .filter((c) => c.d.length > 0);

/**
 * Lookup by ISO numeric id (string).
 */
const byName = new Map<string, CountryShape>();
for (const c of COUNTRIES) byName.set(c.name.toLowerCase(), c);

export function countryByName(name: string): CountryShape | undefined {
  return byName.get(name.toLowerCase());
}

/**
 * Centroid (already projected) for a country, useful for plumes / labels.
 */
const centroidsByName = new Map<string, [number, number]>();
for (const f of collection.features) {
  const c: [number, number] = pathFn.centroid(f);
  if (Number.isFinite(c[0]) && Number.isFinite(c[1])) {
    centroidsByName.set((f.properties?.name ?? '').toLowerCase(), c);
  }
}

export function centroidByName(name: string): [number, number] | undefined {
  return centroidsByName.get(name.toLowerCase());
}
