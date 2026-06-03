/**
 * Threat map — the compact world view that sits beside the gauge. Static
 * (server-rendered): countries tinted by the live severity band, active
 * conflict zones highlighted, major powers outlined, battle plumes over the
 * current hotspots. Heavy work (projection, name join) happens in page.tsx and
 * arrives as serializable `mapData`, so d3-geo + the 108KB topojson never reach
 * the client bundle.
 */
import type { CompositeIndex, SeverityBand } from '@/lib/types';
import type { MilitaryRecord } from '@/lib/military';

const W = 960;
const H = 500;

/** Shared map payload built once on the server, consumed by both maps. */
export interface MapCountry {
  id: string;
  name: string;
  d: string;
  bounds: [number, number, number, number];
  centroid: [number, number] | null;
  flag: string | null;
  mil: MilitaryRecord | null;
}

const HOT_COUNTRIES = new Set([
  'Ukraine', 'Russia', 'Israel', 'Palestine', 'Lebanon', 'Syria', 'Yemen', 'Sudan',
  'Myanmar', 'Somalia', 'South Sudan', 'Ethiopia', 'Mali', 'Burkina Faso', 'Niger',
  'Dem. Rep. Congo', 'Nigeria', 'Iraq', 'Iran', 'Afghanistan', 'Pakistan', 'Mexico', 'Colombia',
]);

const POWER_COUNTRIES = new Set([
  'United States of America', 'China', 'Russia', 'India', 'United Kingdom', 'France',
  'Germany', 'Japan', 'South Korea', 'Turkey', 'Saudi Arabia', 'Brazil', 'Australia',
  'Italy', 'Spain', 'Canada',
]);

const PLUME_COUNTRIES = ['Ukraine', 'Israel', 'Sudan', 'Yemen', 'Myanmar'];

function bandFill(band: SeverityBand, hot: boolean): string {
  if (hot) return '#a8331a';
  if (band === 'red') return '#c46a23';
  if (band === 'yellow') return '#c89a2b';
  return '#7a8c5b';
}
function categoryColor(band: SeverityBand): string {
  return band === 'red' ? '#a8331a' : band === 'yellow' ? '#c89a2b' : '#3b6e3a';
}

export function RiskMap({ composite, mapData }: { composite: CompositeIndex; mapData: MapCountry[] }) {
  const band = composite.band;
  const baseFill = bandFill(band, false);
  const centroidOf = new Map<string, [number, number]>();
  for (const c of mapData) if (c.centroid) centroidOf.set(c.name, c.centroid);

  return (
    <div className="relative parchment rounded-md p-4 sm:p-6 h-full">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h2 className="font-display text-xl sm:text-2xl tracking-[0.2em]">THEATRE OF OPERATIONS</h2>
        <span
          className="stamp"
          style={{ color: band === 'red' ? '#a8331a' : band === 'yellow' ? '#b78a1f' : '#3b6e3a' }}
        >
          {band === 'red' ? 'Red Alert' : band === 'yellow' ? 'Heightened' : 'Stable'}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto select-none"
        role="img"
        aria-label="World threat map: severity band coloring with active conflict zones"
        style={{ filter: 'drop-shadow(0 1px 0 rgba(75,50,20,0.3))' }}
      >
        <rect width="100%" height="100%" fill="rgba(168, 130, 70, 0.05)" />

        {/* graticule */}
        <g stroke="#6b4a26" strokeWidth={0.4} opacity="0.22" fill="none">
          {[-60, -30, 0, 30, 60].map((y) => {
            const py = 250 - (y / 90) * 220;
            return <line key={`lat${y}`} x1="0" y1={py} x2="960" y2={py} />;
          })}
          {[-120, -60, 0, 60, 120].map((x) => {
            const px = 480 + (x / 180) * 460;
            return <line key={`lng${x}`} x1={px} y1="0" x2={px} y2="500" />;
          })}
        </g>

        {/* countries */}
        <g>
          {mapData.map((c, i) => {
            const isHot = HOT_COUNTRIES.has(c.name);
            const isPower = POWER_COUNTRIES.has(c.name);
            const note = isHot ? ' — active conflict zone' : isPower ? ' — major power' : '';
            return (
              <path
                key={`${c.id || 'x'}-${c.name}-${i}`}
                d={c.d}
                fill={bandFill(band, isHot)}
                stroke={isPower ? '#2b1d10' : '#6b4a26'}
                strokeWidth={isPower ? 0.9 : 0.4}
                opacity={isHot ? 0.95 : 0.78}
              >
                <title>{`${c.name}${note}`}</title>
              </path>
            );
          })}
        </g>

        {/* battle plumes over current hotspots */}
        {PLUME_COUNTRIES.map((country) => {
          const c = centroidOf.get(country);
          if (!c) return null;
          return (
            <g key={country} transform={`translate(${c[0]} ${c[1]})`}>
              <polygon
                points="-6,0 -2,-2 0,-9 2,-2 6,0 2,2 0,9 -2,2"
                fill="#6b1d10"
                stroke="#e8d9b0"
                strokeWidth="0.7"
              />
              <circle r="2.4" fill="#d4a843" stroke="#6b1d10" strokeWidth="0.6" />
            </g>
          );
        })}

        {/* compass */}
        <g transform="translate(900, 60)" opacity="0.75">
          <circle r="22" fill="none" stroke="#2b1d10" strokeWidth="1" />
          <path d="M 0 -20 L 5 0 L 0 20 L -5 0 Z" fill="#2b1d10" />
          <path d="M -20 0 L 0 5 L 20 0 L 0 -5 Z" fill="#2b1d10" opacity="0.55" />
          <text y="-26" textAnchor="middle" fontFamily="Cinzel, serif" fontSize="9" fill="#2b1d10">N</text>
        </g>

        {/* legend */}
        <g transform="translate(20, 480)" fontFamily="Cinzel, serif" fontSize="10" fill="#2b1d10">
          <LegendDot x={0} y={0} color="#a8331a" label="Active conflict" />
          <LegendDot x={140} y={0} color={baseFill} label={`World band · ${band}`} />
          <LegendDot x={300} y={0} color="#2b1d10" label="Major power" />
        </g>
      </svg>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 text-ink">
        {(['markets', 'conflicts', 'sentiment', 'military'] as const).map((c) => (
          <CategoryChip key={c} label={c} score={composite.categories[c].score} band={composite.categories[c].band} />
        ))}
      </div>
    </div>
  );
}

function LegendDot({ x, y, color, label }: { x: number; y: number; color: string; label: string }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect width="14" height="9" y="-7" fill={color} stroke="#2b1d10" strokeWidth="0.6" />
      <text x="20" y="0" dominantBaseline="middle">{label}</text>
    </g>
  );
}

function CategoryChip({ label, score, band }: { label: string; score: number; band: SeverityBand }) {
  const fill = categoryColor(band);
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded border border-ink/30 bg-parchment-dark/10">
      <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: fill, boxShadow: '0 0 0 2px #2b1d10' }} />
      <div className="flex-1">
        <div className="font-display text-[0.7rem] tracking-[0.18em] uppercase">{label}</div>
        <div className="font-mono text-sm">{score.toFixed(1)}</div>
      </div>
    </div>
  );
}
