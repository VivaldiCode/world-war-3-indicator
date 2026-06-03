'use client';
/**
 * Interactive theatre map. Two views:
 *   · Threat — world band coloring + active-conflict highlights + plumes.
 *   · Forces — each country in its own color with a stack of military units
 *     (pawns/tanks/planes/ships/missiles) scaled by quantity, RISK-style.
 *
 * Heavy work (projection, name normalization, colors) is done on the server in
 * page.tsx and handed over as serializable `mapData`, so d3-geo and the 108KB
 * topojson never reach the client bundle. This file is pure presentation +
 * pan/zoom interaction.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
} from 'react';
import type { CompositeIndex, SeverityBand } from '@/lib/types';
import type { MilitaryRecord } from '@/lib/military';

const W = 960;
const H = 500;
const MIN_K = 1;
const MAX_K = 14;

export interface MapCountry {
  id: string;
  name: string;
  d: string;
  centroid: [number, number] | null;
  color: string;
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

const PLUME_CITIES: Array<{ country: string; jitter: [number, number] }> = [
  { country: 'Ukraine', jitter: [4, -2] },
  { country: 'Israel', jitter: [0, 0] },
  { country: 'Sudan', jitter: [0, 0] },
  { country: 'Yemen', jitter: [0, 0] },
  { country: 'Myanmar', jitter: [0, 0] },
];

function bandFill(band: SeverityBand, hot: boolean): string {
  if (hot) return '#a8331a';
  if (band === 'red') return '#c46a23';
  if (band === 'yellow') return '#c89a2b';
  return '#7a8c5b';
}
function categoryColor(band: SeverityBand): string {
  return band === 'red' ? '#a8331a' : band === 'yellow' ? '#c89a2b' : '#3b6e3a';
}

// ── military unit scaling ────────────────────────────────────────────────────
type MetricKey = 'personnel' | 'tanks' | 'aircraft' | 'warships' | 'nuclearWeapons';
const METRICS: Array<{ key: MetricKey; per: number; label: string }> = [
  { key: 'personnel', per: 300_000, label: 'troops' },
  { key: 'tanks', per: 1_500, label: 'tanks' },
  { key: 'aircraft', per: 800, label: 'aircraft' },
  { key: 'warships', per: 60, label: 'warships' },
  { key: 'nuclearWeapons', per: 1_500, label: 'nukes' },
];
const MAX_UNITS = 5;

/** Quantity → number of stacked pieces (1..MAX_UNITS), 0 when absent/zero. */
function unitCount(value: number | undefined, per: number): number {
  if (!value || value <= 0) return 0;
  return Math.max(1, Math.min(MAX_UNITS, Math.round(value / per)));
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

// ── unit glyphs (drawn centered at origin, ~4px tall) ────────────────────────
const INK = '#241a0f';
const EDGE = '#f0e3c0';
function Glyph({ kind }: { kind: MetricKey }) {
  switch (kind) {
    case 'personnel': // pawn
      return (
        <g fill={INK} stroke={EDGE} strokeWidth={0.3}>
          <circle cx={0} cy={-1.7} r={1.3} />
          <path d="M-1.8,1.8 L-1.1,-0.4 L1.1,-0.4 L1.8,1.8 Z" />
        </g>
      );
    case 'tanks':
      return (
        <g fill={INK} stroke={EDGE} strokeWidth={0.3}>
          <rect x={-2.6} y={0} width={5.2} height={1.8} rx={0.5} />
          <rect x={-1.4} y={-1.6} width={2.8} height={1.6} rx={0.3} />
          <line x1={0.6} y1={-0.8} x2={3.2} y2={-0.8} stroke={INK} strokeWidth={0.7} />
        </g>
      );
    case 'aircraft': // chevron jet
      return (
        <g fill="#33526b" stroke={EDGE} strokeWidth={0.3}>
          <path d="M0,-2.6 L2.6,1.8 L0,0.7 L-2.6,1.8 Z" />
        </g>
      );
    case 'warships':
      return (
        <g fill="#2f3a44" stroke={EDGE} strokeWidth={0.3}>
          <path d="M-3,0.3 L3,0.3 L2,2.1 L-2,2.1 Z" />
          <rect x={-0.5} y={-2} width={1} height={2.3} />
        </g>
      );
    case 'nuclearWeapons': // missile
      return (
        <g fill="#8a2417" stroke={EDGE} strokeWidth={0.3}>
          <path d="M0,-2.8 L1,-0.8 L1,1.6 L-1,1.6 L-1,-0.8 Z" />
          <path d="M-1,1 L-2,2.2 L-1,1.8 Z M1,1 L2,2.2 L1,1.8 Z" />
        </g>
      );
  }
}

/** A country's army: one column per non-zero metric, pieces stacked upward. */
function ForcesMarker({ mil, showLabels }: { mil: MilitaryRecord; showLabels: boolean }) {
  const cols = METRICS.map((m) => ({ ...m, n: unitCount(mil[m.key], m.per), value: mil[m.key] })).filter(
    (c) => c.n > 0,
  );
  if (cols.length === 0) return null;
  const GAP = 4.8;
  const totalW = (cols.length - 1) * GAP;
  return (
    <g>
      {cols.map((c, i) => {
        const x = -totalW / 2 + i * GAP;
        return (
          <g key={c.key} transform={`translate(${x} 0)`}>
            {Array.from({ length: c.n }).map((_, row) => (
              <g key={row} transform={`translate(0 ${-row * 3.2})`}>
                <Glyph kind={c.key} />
              </g>
            ))}
            {showLabels && c.value !== undefined && (
              <text
                y={4.3}
                textAnchor="middle"
                fontSize={2.6}
                fontFamily="ui-monospace, monospace"
                fill={INK}
              >
                {compact(c.value)}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

// ── transform helpers ────────────────────────────────────────────────────────
interface T {
  x: number;
  y: number;
  k: number;
}
const IDENTITY: T = { x: 0, y: 0, k: 1 };

function clampT(t: T): T {
  const k = Math.max(MIN_K, Math.min(MAX_K, t.k));
  const x = Math.max(W - W * k, Math.min(0, t.x));
  const y = Math.max(H - H * k, Math.min(0, t.y));
  return { x, y, k };
}

export function RiskMap({
  composite,
  mapData,
  updatedAt,
}: {
  composite: CompositeIndex;
  mapData: MapCountry[];
  updatedAt?: string;
}) {
  const [view, setView] = useState<'threat' | 'forces'>('forces');
  const [t, setT] = useState<T>(IDENTITY);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ active: boolean; px: number; py: number } | null>(null);

  const baseBand = composite.band;
  const baseFill = bandFill(baseBand, false);
  const showLabels = t.k >= 3;

  const centroidOf = useMemo(() => {
    const m = new Map<string, [number, number]>();
    for (const c of mapData) if (c.centroid) m.set(c.name, c.centroid);
    return m;
  }, [mapData]);

  // Map a client point to viewBox (pre-transform) coordinates.
  const toViewBox = useCallback((clientX: number, clientY: number) => {
    const el = svgRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * W, y: ((clientY - r.top) / r.height) * H };
  }, []);

  // Non-passive wheel listener so we can preventDefault the page scroll.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const py = ((e.clientY - r.top) / r.height) * H;
      setT((prev) => {
        const factor = Math.exp(-e.deltaY * 0.0015);
        const k = Math.max(MIN_K, Math.min(MAX_K, prev.k * factor));
        // keep the point under the cursor fixed
        const wx = (px - prev.x) / prev.k;
        const wy = (py - prev.y) / prev.k;
        return clampT({ x: px - wx * k, y: py - wy * k, k });
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = useCallback((e: RPointerEvent<SVGSVGElement>) => {
    drag.current = { active: true, px: e.clientX, py: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);
  const onPointerMove = useCallback(
    (e: RPointerEvent<SVGSVGElement>) => {
      const d = drag.current;
      if (!d?.active) return;
      const el = svgRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = ((e.clientX - d.px) / r.width) * W;
      const dy = ((e.clientY - d.py) / r.height) * H;
      drag.current = { active: true, px: e.clientX, py: e.clientY };
      setT((prev) => clampT({ ...prev, x: prev.x + dx, y: prev.y + dy }));
    },
    [],
  );
  const endDrag = useCallback((e: RPointerEvent<SVGSVGElement>) => {
    if (drag.current) drag.current.active = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const zoomBy = (mult: number) =>
    setT((prev) => {
      const k = Math.max(MIN_K, Math.min(MAX_K, prev.k * mult));
      const cx = W / 2, cy = H / 2;
      const wx = (cx - prev.x) / prev.k;
      const wy = (cy - prev.y) / prev.k;
      return clampT({ x: cx - wx * k, y: cy - wy * k, k });
    });

  return (
    <div className="relative parchment rounded-md p-4 sm:p-6">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h2 className="font-display text-xl sm:text-2xl tracking-[0.2em]">THEATRE OF OPERATIONS</h2>
        <div className="flex items-center gap-2">
          <div className="flex rounded overflow-hidden border border-ink/40">
            {(['forces', 'threat'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-label={`${v} view`}
                aria-pressed={view === v}
                className={`px-3 py-1 text-[0.7rem] font-display tracking-[0.18em] uppercase transition-colors ${
                  view === v ? 'bg-ink text-parchment' : 'bg-transparent text-ink hover:bg-ink/10'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <span
            className="stamp"
            style={{ color: baseBand === 'red' ? '#a8331a' : baseBand === 'yellow' ? '#b78a1f' : '#3b6e3a' }}
          >
            {baseBand === 'red' ? 'Red Alert' : baseBand === 'yellow' ? 'Heightened' : 'Stable'}
          </span>
        </div>
      </div>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto select-none touch-none"
          role="img"
          aria-label="World theatre of operations map"
          style={{
            filter: 'drop-shadow(0 1px 0 rgba(75,50,20,0.3))',
            cursor: drag.current?.active ? 'grabbing' : 'grab',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
        >
          <rect width="100%" height="100%" fill="rgba(168, 130, 70, 0.05)" />

          <g transform={`translate(${t.x} ${t.y}) scale(${t.k})`}>
            {/* graticule */}
            <g stroke="#6b4a26" strokeWidth={0.4 / t.k} opacity="0.25" fill="none">
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
                const fill = view === 'forces' ? c.color : bandFill(baseBand, isHot);
                const m = c.mil;
                return (
                  <path
                    key={`${c.id || 'x'}-${c.name}-${i}`}
                    d={c.d}
                    fill={fill}
                    stroke={isPower ? '#2b1d10' : '#6b4a26'}
                    strokeWidth={(isPower ? 0.9 : 0.4) / t.k}
                    opacity={view === 'forces' ? 0.85 : isHot ? 0.95 : 0.78}
                  >
                    <title>
                      {c.name}
                      {view === 'forces' && m
                        ? ` — ${[
                            m.personnel && `${compact(m.personnel)} troops`,
                            m.tanks && `${compact(m.tanks)} tanks`,
                            m.aircraft && `${compact(m.aircraft)} aircraft`,
                            m.warships && `${compact(m.warships)} warships`,
                            m.submarines && `${compact(m.submarines)} subs`,
                            m.nuclearWeapons && `${compact(m.nuclearWeapons)} nukes`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}`
                        : isHot
                          ? ' — active conflict zone'
                          : isPower
                            ? ' — major power'
                            : ''}
                    </title>
                  </path>
                );
              })}
            </g>

            {/* forces: unit stacks at each country centroid */}
            {view === 'forces' && (
              <g>
                {mapData.map((c) =>
                  c.mil && c.centroid ? (
                    <g
                      key={`mk-${c.name}`}
                      transform={`translate(${c.centroid[0]} ${c.centroid[1]}) scale(1.3)`}
                    >
                      <ForcesMarker mil={c.mil} showLabels={showLabels} />
                    </g>
                  ) : null,
                )}
              </g>
            )}

            {/* threat: battle plumes */}
            {view === 'threat' &&
              PLUME_CITIES.map(({ country, jitter }) => {
                const c = centroidOf.get(country);
                if (!c) return null;
                return (
                  <g key={country} transform={`translate(${c[0] + jitter[0]} ${c[1] + jitter[1]}) scale(${1 / t.k})`}>
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
          </g>

          {/* compass — fixed overlay (outside pan/zoom) */}
          <g transform="translate(900, 60)" opacity="0.75">
            <circle r="22" fill="none" stroke="#2b1d10" strokeWidth="1" />
            <path d="M 0 -20 L 5 0 L 0 20 L -5 0 Z" fill="#2b1d10" />
            <path d="M -20 0 L 0 5 L 20 0 L 0 -5 Z" fill="#2b1d10" opacity="0.55" />
            <text y="-26" textAnchor="middle" fontFamily="Cinzel, serif" fontSize="9" fill="#2b1d10">N</text>
          </g>

          {/* legend — fixed overlay */}
          <g transform="translate(20, 480)" fontFamily="Cinzel, serif" fontSize="10" fill="#2b1d10">
            {view === 'forces' ? (
              <LegendUnits />
            ) : (
              <>
                <LegendDot x={0} y={0} color="#a8331a" label="Active conflict" />
                <LegendDot x={140} y={0} color={baseFill} label={`World band · ${baseBand}`} />
                <LegendDot x={290} y={0} color="#2b1d10" label="Major power border" />
              </>
            )}
          </g>
        </svg>

        {/* zoom controls */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          <ZoomBtn onClick={() => zoomBy(1.5)} label="+" />
          <ZoomBtn onClick={() => zoomBy(1 / 1.5)} label="−" />
          <ZoomBtn onClick={() => setT(IDENTITY)} label="⟲" />
        </div>
        <div className="absolute bottom-2 right-3 text-[0.6rem] uppercase tracking-[0.25em] text-ink/50 font-display">
          {view === 'forces' ? 'scroll to zoom · drag to pan · zoom in for counts' : 'scroll to zoom · drag to pan'}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 text-ink">
        {(['markets', 'conflicts', 'sentiment', 'military'] as const).map((c) => (
          <CategoryChip key={c} label={c} score={composite.categories[c].score} band={composite.categories[c].band} />
        ))}
      </div>

      {updatedAt && (
        <div className="mt-2 text-[0.6rem] uppercase tracking-[0.25em] text-ink/40 font-display">
          force data · {new Date(updatedAt).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}

function ZoomBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="w-7 h-7 flex items-center justify-center rounded border border-ink/40 bg-parchment/80 text-ink text-sm font-display hover:bg-ink hover:text-parchment transition-colors"
      aria-label={`zoom ${label}`}
    >
      {label}
    </button>
  );
}

function LegendUnits() {
  return (
    <g>
      {METRICS.map((m, i) => (
        <g key={m.key} transform={`translate(${i * 90} 0)`}>
          <g transform="translate(5 -3) scale(1.1)">
            <Glyph kind={m.key} />
          </g>
          <text x="14" y="0" dominantBaseline="middle">{m.label}</text>
        </g>
      ))}
    </g>
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
