'use client';
/**
 * Forces map — the full-width interactive board. Every country is painted with
 * its flag (SVG pattern fill); hovering a country raises a parchment tooltip
 * with its military footprint, rendered with clean inline-SVG unit icons. Pan
 * by dragging, zoom with the wheel or the +/- controls.
 *
 * No d3-geo or topojson here: page.tsx projects the shapes and joins the
 * military + flag data on the server, handing over serializable `mapData`.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
  type ReactNode,
} from 'react';
import type { MapCountry } from '@/components/RiskMap';
import type { MilitaryRecord } from '@/lib/military';
import { flagUrl } from '@/lib/flags';
import { SAT_OWNERS, ownersPresent, type SatElements } from '@/lib/satellites';
import { makeProjector, subPoint } from '@/lib/orbit';
import { deployerColor, deployersPresent, type Deployment } from '@/lib/deployments';
import { FLIGHT_CATS, flightCatsPresent, type Flight, type FlightCategory } from '@/lib/flights';
import {
  CONFLICT_CATS,
  catForRoot,
  conflictCatsPresent,
  type ConflictEvent,
  type ConflictCat,
} from '@/lib/conflicts';

const W = 960;
const H = 500;
const MIN_K = 1;
const MAX_K = 14;
const NEUTRAL = '#cdbb91'; // countries with no flag in our table
const SAT_WARP = 200; // sim seconds per real second — fast enough to see motion
const SAT_FPS = 30; // throttle the position loop
const SAT_R = 1.8; // dot radius in viewBox units (constant on screen)

// ── deployment arcs ───────────────────────────────────────────────────────────
const ARC_W_MIN = 0.7; // screen px (non-scaling stroke) for an unknown-size presence
const ARC_W_MAX = 2.6; // screen px for the largest deployments
const SHORT_NAME: Record<string, string> = {
  'United States of America': 'USA',
  'United Kingdom': 'UK',
  'United Arab Emirates': 'UAE',
};
const shortName = (n: string) => SHORT_NAME[n] ?? n;

/** Map a (possibly missing) troop figure to a constant-on-screen stroke width. */
function arcWidth(troops?: number): number {
  if (!troops || troops <= 0) return ARC_W_MIN;
  const t = Math.min(ARC_W_MAX, ARC_W_MIN + Math.max(0, Math.log10(troops) - 2) * 0.62);
  return t;
}

// ── live military flights ─────────────────────────────────────────────────────
const FLIGHT_FPS = 12; // aircraft creep slowly; a low frame rate is plenty
const FLIGHT_POLL_MS = 20_000; // re-pull the live feed
const FLIGHT_WARP = 1; // sim seconds per real second. 1 = honest real-time; raise
// for dramatized motion, at the cost of a re-anchor snap each poll when zoomed in.
const FLIGHT_GLYPH = 'M0,-4.6 L2.9,3.9 L0,1.9 L-2.9,3.9 Z'; // arrowhead pointing north (track 0)

/**
 * Advance an aircraft along its reported track for `dtSec` seconds (flat-earth
 * stepping is fine at these speeds/zoom). gs is in knots, track in degrees
 * clockwise from north; drift is capped so a stalled poll can't fling a contact
 * across the map.
 */
function deadReckon(f: Flight, dtSec: number): [number, number] {
  if (f.gs == null || f.track == null || f.gs <= 0) return [f.lon, f.lat];
  const simDt = Math.min(Math.max(dtSec, 0) * FLIGHT_WARP, 600);
  const degLatPerSec = f.gs / 216000; // 1 kn = 1 nm/h; 1 nm = 1/60° latitude
  const tr = (f.track * Math.PI) / 180;
  const lat = f.lat + degLatPerSec * Math.cos(tr) * simDt;
  const cosLat = Math.cos((f.lat * Math.PI) / 180) || 1e-6;
  const lon = f.lon + (degLatPerSec * Math.sin(tr) * simDt) / cosLat;
  return [lon, lat];
}

// ── conflict-event markers ─────────────────────────────────────────────────────
const CONFLICT_DIAMOND = 'M0,-1 L1,0 L0,1 L-1,0 Z'; // unit diamond, scaled per marker
/** News-mention count → constant-on-screen diamond half-size (px). */
function markerSize(mentions: number): number {
  return Math.max(2.2, Math.min(5.5, 1.4 + Math.log10(Math.max(1, mentions)) * 1.4));
}
/** Darker (more negative) GDELT tone → a more opaque, "hotter" marker. */
function toneOpacity(tone: number): number {
  const neg = Math.max(2, Math.min(8, -tone)); // clamp to the meaningful band
  return 0.6 + ((neg - 2) / 6) * 0.38; // 0.60 … 0.98
}

// ── view presets ──────────────────────────────────────────────────────────────
// Five overlays at once overwhelms the map, so presets flip whole layer combos
// in one click. The map loads on "Conflict" (calmest) and "All" is a click away.
interface LayerState { cons: boolean; deps: boolean; sats: boolean; flights: boolean }
const PRESETS: Array<{ id: string; label: string; state: LayerState }> = [
  { id: 'conflict', label: 'Conflict', state: { cons: true, deps: false, sats: false, flights: false } },
  { id: 'power', label: 'Power', state: { cons: false, deps: true, sats: false, flights: false } },
  { id: 'live', label: 'Air/space', state: { cons: false, deps: false, sats: true, flights: true } },
  { id: 'all', label: 'All', state: { cons: true, deps: true, sats: true, flights: true } },
  { id: 'clear', label: 'Flags only', state: { cons: false, deps: false, sats: false, flights: false } },
];

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

// ── clean unit icons (24×24, currentColor) ───────────────────────────────────
type MetricKey =
  | 'personnel' | 'tanks' | 'aircraft' | 'warships'
  | 'submarines' | 'nuclearWeapons' | 'militarySatellites';

const METRICS: Array<{ key: MetricKey; label: string }> = [
  { key: 'personnel', label: 'Active troops' },
  { key: 'tanks', label: 'Tanks' },
  { key: 'aircraft', label: 'Combat aircraft' },
  { key: 'warships', label: 'Warships' },
  { key: 'submarines', label: 'Submarines' },
  { key: 'nuclearWeapons', label: 'Nuclear warheads' },
  { key: 'militarySatellites', label: 'Mil. satellites' },
];

function UnitIcon({ kind }: { kind: MetricKey }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'currentColor' as const };
  switch (kind) {
    case 'personnel': // pawn
      return (
        <svg {...common} aria-hidden>
          <circle cx="12" cy="6" r="3.2" />
          <path d="M8 11h8l1.5 9h-11z" />
        </svg>
      );
    case 'tanks':
      return (
        <svg {...common} aria-hidden>
          <rect x="3" y="13" width="18" height="5" rx="1.2" />
          <rect x="7" y="9" width="9" height="4" rx="1" />
          <rect x="15" y="10" width="7" height="1.6" rx="0.8" />
          <circle cx="6" cy="19.5" r="1.6" />
          <circle cx="12" cy="19.5" r="1.6" />
          <circle cx="18" cy="19.5" r="1.6" />
        </svg>
      );
    case 'aircraft': // top-down jet
      return (
        <svg {...common} aria-hidden>
          <path d="M11 2h2l1 7 8 4v2l-8-2-.6 6 2.6 1.6v1.4l-4-1-4 1v-1.4l2.6-1.6L10 13l-8 2v-2l8-4z" />
        </svg>
      );
    case 'warships':
      return (
        <svg {...common} aria-hidden>
          <path d="M2 14h20l-2.5 5h-15z" />
          <rect x="9" y="7" width="6" height="6" />
          <rect x="11" y="3" width="2" height="4" />
        </svg>
      );
    case 'submarines':
      return (
        <svg {...common} aria-hidden>
          <path d="M3 12c3-4 15-4 18 0-3 4-15 4-18 0z" />
          <rect x="10" y="5" width="3" height="4" rx="0.8" />
          <rect x="13" y="6" width="4" height="1.4" rx="0.7" />
          <circle cx="18.5" cy="12" r="1" fill="#f0e3c0" />
        </svg>
      );
    case 'nuclearWeapons': // missile
      return (
        <svg {...common} aria-hidden>
          <path d="M12 1c2 2 3 5 3 9v6h-6v-6c0-4 1-7 3-9z" />
          <path d="M9 16l-3 4 3-1zM15 16l3 4-3-1z" />
          <rect x="11" y="20" width="2" height="3" />
        </svg>
      );
    case 'militarySatellites':
      return (
        <svg {...common} aria-hidden>
          <rect x="10" y="9" width="4" height="6" rx="0.8" />
          <path d="M2 10l6-2 1 4-6 2zM22 10l-6-2-1 4 6 2z" />
          <rect x="11.2" y="4" width="1.6" height="5" />
          <circle cx="12" cy="3.2" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
  }
}

// ── transform helpers ─────────────────────────────────────────────────────────
interface T { x: number; y: number; k: number }
const IDENTITY: T = { x: 0, y: 0, k: 1 };
function clampT(t: T): T {
  const k = Math.max(MIN_K, Math.min(MAX_K, t.k));
  const x = Math.max(W - W * k, Math.min(0, t.x));
  const y = Math.max(H - H * k, Math.min(0, t.y));
  return { x, y, k };
}

interface Hover { c: MapCountry; x: number; y: number }
interface ConHover { ev: ConflictEvent; x: number; y: number }

export function ForcesMap({
  mapData,
  updatedAt,
  satellites,
  projection,
  satUpdatedAt,
  deployments,
  depUpdatedAt,
  conflicts,
  conUpdatedAt,
  conWindowHours,
}: {
  mapData: MapCountry[];
  updatedAt?: string;
  satellites?: SatElements[];
  projection?: { scale: number; translate: [number, number] };
  satUpdatedAt?: string;
  deployments?: Deployment[];
  depUpdatedAt?: string;
  conflicts?: ConflictEvent[];
  conUpdatedAt?: string;
  conWindowHours?: number;
}) {
  const [t, setT] = useState<T>(IDENTITY);
  const [hover, setHover] = useState<Hover | null>(null);
  const [conHover, setConHover] = useState<ConHover | null>(null);
  // Default to the calmest useful view ("Conflict" preset); other layers are a
  // preset/toggle click away.
  const [showSats, setShowSats] = useState(false);
  const [showDeps, setShowDeps] = useState(false);
  const [showConflicts, setShowConflicts] = useState(true);
  const [showFlights, setShowFlights] = useState(false);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [flightsAt, setFlightsAt] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ active: boolean; px: number; py: number; moved: boolean } | null>(null);

  // Satellite overlay: rebuild the server projection once, hold the live
  // transform in a ref so the rAF loop can read it without re-subscribing.
  const sats = useMemo(() => satellites ?? [], [satellites]);
  const satOwners = useMemo(() => ownersPresent(sats), [sats]);
  const projector = useMemo(
    () => (projection ? makeProjector(projection.scale, projection.translate) : null),
    [projection],
  );
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);
  const satEls = useRef<(SVGCircleElement | null)[]>([]);
  // Client-only: keeps the dots out of the SSR HTML (no flash at the origin
  // before the animation loop runs).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const satsActive = mounted && showSats && !!projector && sats.length > 0;

  // Deployment arcs: a bowed quadratic from the deploying country's centroid to
  // each host's. Pure geometry in map space, so it lives inside the zoom group
  // and pans/zooms for free; the stroke is non-scaling so width stays constant.
  const deps = useMemo(() => deployments ?? [], [deployments]);
  const depOwners = useMemo(() => deployersPresent(deps), [deps]);
  const arcs = useMemo(() => {
    const centroid = new Map<string, [number, number]>();
    for (const c of mapData) if (c.centroid) centroid.set(c.name, c.centroid);
    const out: Array<{ key: string; from: string; to: string; d: string; color: string; w: number }> = [];
    for (let i = 0; i < deps.length; i++) {
      const dep = deps[i];
      const a = centroid.get(dep.from);
      const b = centroid.get(dep.to);
      if (!a || !b) continue;
      const [x0, y0] = a;
      const [x1, y1] = b;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy) || 1;
      const bow = Math.min(70, len * 0.2);
      // Control point offset perpendicular to the chord (consistent side).
      const cx = (x0 + x1) / 2 - (dy / len) * bow;
      const cy = (y0 + y1) / 2 + (dx / len) * bow;
      out.push({
        key: `arc-${i}`,
        from: dep.from,
        to: dep.to,
        d: `M${x0.toFixed(1)},${y0.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`,
        color: deployerColor(dep.from),
        w: arcWidth(dep.troops),
      });
    }
    return out;
  }, [deps, mapData]);
  const depsActive = showDeps && arcs.length > 0;
  const hoverName = hover?.c.name ?? null;

  // Conflict incidents: GDELT flashpoints projected once to map space (static,
  // so no rAF) and drawn inside the zoom group as constant-size diamonds.
  const cons = useMemo(() => conflicts ?? [], [conflicts]);
  const projConflicts = useMemo(() => {
    if (!projector) return [];
    const out: Array<{
      key: string;
      x: number;
      y: number;
      size: number;
      opacity: number;
      cat: ConflictCat;
      ev: ConflictEvent;
    }> = [];
    for (let i = 0; i < cons.length; i++) {
      const c = cons[i];
      const xy = projector(c.lon, c.lat);
      if (!xy) continue;
      out.push({
        key: `con-${i}`,
        x: xy[0],
        y: xy[1],
        size: markerSize(c.mentions),
        opacity: toneOpacity(c.tone),
        cat: catForRoot(c.root),
        ev: c,
      });
    }
    return out;
  }, [cons, projector]);
  const conCats = useMemo(() => {
    const count = new Map<ConflictCat, number>();
    for (const c of cons) {
      const cat = catForRoot(c.root);
      count.set(cat, (count.get(cat) ?? 0) + 1);
    }
    return { order: conflictCatsPresent(cons), count };
  }, [cons]);
  const conflictsActive = showConflicts && projConflicts.length > 0;

  const applyPreset = useCallback((s: LayerState) => {
    setShowConflicts(s.cons);
    setShowDeps(s.deps);
    setShowSats(s.sats);
    setShowFlights(s.flights);
  }, []);
  const activePreset =
    PRESETS.find(
      (p) =>
        p.state.cons === showConflicts &&
        p.state.deps === showDeps &&
        p.state.sats === showSats &&
        p.state.flights === showFlights,
    )?.id ?? null;

  // Live military flights: polled from our /api/flights proxy and dead-reckoned
  // between polls. Like satellites they live in screen space, keyed by hex so
  // the DOM survives the set churning each poll; the rAF loop applies the zoom.
  const flightEls = useRef<Map<string, SVGGElement>>(new Map());
  const flightsRef = useRef<Flight[]>([]);
  const flightT0Ref = useRef<number>(Date.now());
  useEffect(() => {
    flightsRef.current = flights;
    flightT0Ref.current = Date.now();
  }, [flights]);
  const flightCats = useMemo(() => {
    const count = new Map<FlightCategory, number>();
    for (const f of flights) count.set(f.cat, (count.get(f.cat) ?? 0) + 1);
    return { order: flightCatsPresent(flights), count };
  }, [flights]);
  const flightsActive = mounted && showFlights && !!projector && flights.length > 0;

  // Poll the live feed while the layer is on; stop when toggled off.
  useEffect(() => {
    if (!mounted || !showFlights) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const r = await fetch('/api/flights', { cache: 'no-store' });
        if (r.ok) {
          const j = (await r.json()) as { aircraft?: Flight[]; updatedAt?: string };
          if (alive && Array.isArray(j.aircraft)) {
            setFlights(j.aircraft);
            setFlightsAt(j.updatedAt ?? new Date().toISOString());
          }
        }
      } catch {
        /* keep the last batch on a transient failure */
      } finally {
        if (alive) timer = setTimeout(load, FLIGHT_POLL_MS);
      }
    };
    load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [mounted, showFlights]);

  const toViewBox = useCallback((clientX: number, clientY: number) => {
    const el = svgRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * W, y: ((clientY - r.top) / r.height) * H };
  }, []);

  // Non-passive wheel so we can stop the page from scrolling while zooming.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { x: px, y: py } = toViewBox(e.clientX, e.clientY);
      setT((prev) => {
        const k = Math.max(MIN_K, Math.min(MAX_K, prev.k * Math.exp(-e.deltaY * 0.0015)));
        const wx = (px - prev.x) / prev.k;
        const wy = (py - prev.y) / prev.k;
        return clampT({ x: px - wx * k, y: py - wy * k, k });
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [toViewBox]);

  const onPointerDown = useCallback((e: RPointerEvent<SVGSVGElement>) => {
    drag.current = { active: true, px: e.clientX, py: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);
  const onPointerMove = useCallback((e: RPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d?.active) return;
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = ((e.clientX - d.px) / r.width) * W;
    const dy = ((e.clientY - d.py) / r.height) * H;
    drag.current = { active: true, px: e.clientX, py: e.clientY, moved: true };
    setHover(null); // hide tooltips while panning
    setConHover(null);
    setT((prev) => clampT({ ...prev, x: prev.x + dx, y: prev.y + dy }));
  }, []);
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

  // Tooltip position: cursor-relative within the wrapper, flipped near edges.
  const moveHover = useCallback((c: MapCountry, clientX: number, clientY: number) => {
    if (drag.current?.active) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    setConHover(null); // country hover wins over a stale incident tooltip
    setHover({ c, x: clientX - r.left, y: clientY - r.top });
  }, []);

  // Incident tooltip: hovering a conflict marker shows its detail and suppresses
  // the country tooltip underneath.
  const moveConHover = useCallback((ev: ConflictEvent, clientX: number, clientY: number) => {
    if (drag.current?.active) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    setHover(null);
    setConHover({ ev, x: clientX - r.left, y: clientY - r.top });
  }, []);

  // Animate the satellite layer: a time-warped clock drives the Keplerian
  // propagation and positions are written straight to the DOM — no per-frame
  // React render. The dots live in screen space, so apply the live zoom here.
  useEffect(() => {
    if (!satsActive || !projector) return;
    const paint = (simDate: Date) => {
      const tt = tRef.current;
      const els = satEls.current;
      for (let i = 0; i < sats.length; i++) {
        const el = els[i];
        if (!el) continue;
        const { lng, lat } = subPoint(sats[i], simDate);
        const xy = projector(lng, lat);
        if (!xy) {
          el.style.display = 'none';
          continue;
        }
        el.setAttribute('cx', String(tt.x + xy[0] * tt.k));
        el.setAttribute('cy', String(tt.y + xy[1] * tt.k));
        if (el.style.display === 'none') el.style.display = '';
      }
    };

    let raf = 0;
    let last = 0;
    const startWall = performance.now();
    const t0 = Date.now();
    const frameGap = 1000 / SAT_FPS;
    // Paint once synchronously so the dots have valid positions immediately —
    // browsers pause requestAnimationFrame on a hidden tab, so without this the
    // first frame (and thus the first position) would never arrive until the
    // tab is focused.
    paint(new Date(t0));
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < frameGap) return;
      last = now;
      paint(new Date(t0 + (now - startWall) * SAT_WARP));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [satsActive, projector, sats]);

  // Animate flights: dead-reckon each aircraft from the last poll and write the
  // transform straight to the DOM (no per-frame React render). Glyphs rotate to
  // the reported track; positions are screen space, so apply the live zoom.
  useEffect(() => {
    if (!flightsActive || !projector) return;
    const paint = () => {
      const tt = tRef.current;
      const els = flightEls.current;
      const list = flightsRef.current;
      const dtSec = (Date.now() - flightT0Ref.current) / 1000;
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        const el = els.get(f.hex);
        if (!el) continue;
        const [lng, lat] = deadReckon(f, dtSec);
        const xy = projector(lng, lat);
        if (!xy) {
          el.style.display = 'none';
          continue;
        }
        const x = tt.x + xy[0] * tt.k;
        const y = tt.y + xy[1] * tt.k;
        el.setAttribute(
          'transform',
          `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(f.track ?? 0).toFixed(0)})`,
        );
        if (el.style.display === 'none') el.style.display = '';
      }
    };

    let raf = 0;
    let last = 0;
    const frameGap = 1000 / FLIGHT_FPS;
    paint(); // sync first paint — rAF is paused on hidden tabs
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < frameGap) return;
      last = now;
      paint();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flightsActive, projector]);

  return (
    <div className="relative parchment rounded-md p-4 sm:p-6">
      <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
        <h2 className="font-display text-xl sm:text-2xl tracking-[0.2em]">ORDER OF BATTLE</h2>
        <span className="text-[0.65rem] uppercase tracking-[0.3em] text-ink/50 font-display">
          hover a nation · scroll to zoom · drag to pan
        </span>
      </div>
      <div className="flex items-center justify-between mb-3 gap-x-4 gap-y-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[0.58rem] uppercase tracking-[0.2em] text-ink/45 font-display mr-0.5">views</span>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p.state)}
              aria-pressed={activePreset === p.id}
              className={`px-2 py-1 rounded border text-[0.58rem] uppercase tracking-[0.18em] font-display transition-colors ${
                activePreset === p.id
                  ? 'border-ink/60 bg-ink text-parchment'
                  : 'border-ink/25 bg-parchment/50 text-ink/70 hover:bg-parchment'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {projConflicts.length > 0 && (
            <button
              onClick={() => setShowConflicts((v) => !v)}
              aria-pressed={showConflicts}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-[0.6rem] uppercase tracking-[0.2em] font-display transition-colors ${
                showConflicts
                  ? 'border-ink/50 bg-ink text-parchment'
                  : 'border-ink/30 bg-parchment/60 text-ink/70 hover:bg-parchment'
              }`}
            >
              <span
                className="inline-block w-2 h-2 rotate-45"
                style={{
                  backgroundColor: showConflicts ? '#c0392b' : 'transparent',
                  boxShadow: showConflicts ? '0 0 0 1px #1c1208' : 'inset 0 0 0 1px #1c1208',
                }}
              />
              conflicts
            </button>
          )}
          {arcs.length > 0 && (
            <button
              onClick={() => setShowDeps((v) => !v)}
              aria-pressed={showDeps}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-[0.6rem] uppercase tracking-[0.2em] font-display transition-colors ${
                showDeps
                  ? 'border-ink/50 bg-ink text-parchment'
                  : 'border-ink/30 bg-parchment/60 text-ink/70 hover:bg-parchment'
              }`}
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{
                  backgroundColor: showDeps ? '#2f6fb0' : 'transparent',
                  boxShadow: showDeps ? '0 0 0 1px #1c1208' : 'inset 0 0 0 1px #1c1208',
                }}
              />
              deployments
            </button>
          )}
          {sats.length > 0 && (
            <button
              onClick={() => setShowSats((v) => !v)}
              aria-pressed={showSats}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-[0.6rem] uppercase tracking-[0.2em] font-display transition-colors ${
                showSats
                  ? 'border-ink/50 bg-ink text-parchment'
                  : 'border-ink/30 bg-parchment/60 text-ink/70 hover:bg-parchment'
              }`}
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{
                  backgroundColor: showSats ? '#3fb8cf' : 'transparent',
                  boxShadow: showSats ? '0 0 0 1px #1c1208' : 'inset 0 0 0 1px #1c1208',
                }}
              />
              satellites
            </button>
          )}
          {flights.length > 0 && (
            <button
              onClick={() => setShowFlights((v) => !v)}
              aria-pressed={showFlights}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-[0.6rem] uppercase tracking-[0.2em] font-display transition-colors ${
                showFlights
                  ? 'border-ink/50 bg-ink text-parchment'
                  : 'border-ink/30 bg-parchment/60 text-ink/70 hover:bg-parchment'
              }`}
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{
                  backgroundColor: showFlights ? '#d96a4a' : 'transparent',
                  boxShadow: showFlights ? '0 0 0 1px #1c1208' : 'inset 0 0 0 1px #1c1208',
                }}
              />
              flights
            </button>
          )}
        </div>
      </div>

      <div ref={wrapRef} className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto select-none touch-none"
          role="img"
          aria-label="Interactive world map of national military forces"
          style={{ cursor: drag.current?.active ? 'grabbing' : 'grab' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={(e) => { endDrag(e); setHover(null); setConHover(null); }}
        >
          <defs>
            {mapData.map((c, i) =>
              c.flag ? (
                <clipPath key={`clip-${i}`} id={`fc-${i}`}>
                  <path d={c.d} />
                </clipPath>
              ) : null,
            )}
          </defs>

          <rect width="100%" height="100%" fill="rgba(40, 30, 16, 0.06)" />

          <g transform={`translate(${t.x} ${t.y}) scale(${t.k})`}>
            {/* fill layer: flag image clipped to each shape, or neutral tint */}
            <g style={{ pointerEvents: 'none' }}>
              {mapData.map((c, i) => {
                if (!c.flag) return <path key={`fill-${i}`} d={c.d} fill={NEUTRAL} opacity={0.9} />;
                const [x0, y0, x1, y1] = c.bounds;
                return (
                  <image
                    key={`img-${i}`}
                    href={flagUrl(c.flag)}
                    x={x0}
                    y={y0}
                    width={Math.max(0.01, x1 - x0)}
                    height={Math.max(0.01, y1 - y0)}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#fc-${i})`}
                    opacity={0.95}
                  />
                );
              })}
            </g>

            {/* deployment arcs — power-projection lines from each deploying
                country to its foreign hosts. Inside the zoom group so they
                track pan + zoom; non-scaling stroke keeps width constant and
                the dash animation makes each line "flow" toward its host. */}
            {depsActive && (
              <g style={{ pointerEvents: 'none' }}>
                <style>{`@keyframes ww3flow{to{stroke-dashoffset:-8}}`}</style>
                {arcs.map((a) => {
                  const lit = !hoverName || a.from === hoverName || a.to === hoverName;
                  return (
                    <path
                      key={a.key}
                      d={a.d}
                      fill="none"
                      stroke={a.color}
                      strokeWidth={a.w}
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                      opacity={hoverName ? (lit ? 0.95 : 0.06) : 0.5}
                      style={{ strokeDasharray: '3 5', animation: 'ww3flow 0.9s linear infinite' }}
                    />
                  );
                })}
              </g>
            )}

            {/* border + hit layer: transparent fill keeps shapes hoverable */}
            <g>
              {mapData.map((c, i) => {
                const isHover = hover?.c.name === c.name;
                return (
                  <path
                    key={`hit-${i}`}
                    d={c.d}
                    fill="transparent"
                    stroke={isHover ? '#1c1208' : '#3a2a16'}
                    strokeWidth={(isHover ? 1.8 : 0.4) / t.k}
                    style={{ pointerEvents: 'all' }}
                    onMouseEnter={(e) => moveHover(c, e.clientX, e.clientY)}
                    onMouseMove={(e) => moveHover(c, e.clientX, e.clientY)}
                    onMouseLeave={() => setHover((h) => (h?.c.name === c.name ? null : h))}
                  >
                    <title>{c.name}</title>
                  </path>
                );
              })}
            </g>

            {/* conflict incidents — recent GDELT flashpoints as constant-size
                diamonds inside the zoom group (static; sized by news mentions,
                coloured by the dominant CAMEO event root). The child scale
                cancels the group's zoom so the glyph stays a fixed screen size. */}
            {conflictsActive && (
              <g style={{ pointerEvents: 'none' }}>
                {projConflicts.map((c) => (
                  <g
                    key={c.key}
                    transform={`translate(${c.x.toFixed(1)} ${c.y.toFixed(1)}) scale(${(c.size / t.k).toFixed(3)})`}
                  >
                    <path
                      d={CONFLICT_DIAMOND}
                      fill={CONFLICT_CATS[c.cat].color}
                      stroke="#1c1208"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                      opacity={c.opacity}
                    />
                    {/* invisible halo gives the tiny diamond a usable hover target */}
                    <circle
                      r={1.9}
                      fill="transparent"
                      style={{ pointerEvents: 'auto', cursor: 'help' }}
                      onMouseEnter={(e) => moveConHover(c.ev, e.clientX, e.clientY)}
                      onMouseMove={(e) => moveConHover(c.ev, e.clientX, e.clientY)}
                      onMouseLeave={() => setConHover(null)}
                    />
                  </g>
                ))}
              </g>
            )}
          </g>

          {/* satellite overlay — screen space (outside the zoom group); the
              rAF loop applies the current transform so dots track pan + zoom */}
          {satsActive && (
            <g style={{ pointerEvents: 'none' }}>
              {sats.map((s, i) => (
                <circle
                  key={`sat-${i}`}
                  ref={(el) => {
                    satEls.current[i] = el;
                    if (el && !el.dataset.on) {
                      el.dataset.on = '1';
                      el.style.display = 'none';
                    }
                  }}
                  r={SAT_R}
                  fill={SAT_OWNERS[s.owner].color}
                  stroke="#1c1208"
                  strokeWidth={0.5}
                />
              ))}
            </g>
          )}

          {/* live military flights — screen space (outside the zoom group); the
              rAF loop dead-reckons each contact and applies the current
              transform, and rotates the glyph to the reported track */}
          {flightsActive && (
            <g style={{ pointerEvents: 'none' }}>
              {flights.map((f) => (
                <g
                  key={f.hex}
                  ref={(el) => {
                    const m = flightEls.current;
                    if (el) {
                      m.set(f.hex, el);
                      if (!el.dataset.on) {
                        el.dataset.on = '1';
                        el.style.display = 'none'; // hidden until the loop places it
                      }
                    } else {
                      m.delete(f.hex);
                    }
                  }}
                >
                  <path
                    d={FLIGHT_GLYPH}
                    fill={FLIGHT_CATS[f.cat].color}
                    stroke="#1c1208"
                    strokeWidth={0.5}
                    strokeLinejoin="round"
                  />
                </g>
              ))}
            </g>
          )}
        </svg>

        {/* zoom controls */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          <ZoomBtn onClick={() => zoomBy(1.5)} label="+" />
          <ZoomBtn onClick={() => zoomBy(1 / 1.5)} label="−" />
          <ZoomBtn onClick={() => setT(IDENTITY)} label="⟲" />
        </div>

        {hover && !conHover && <ForcesTooltip hover={hover} wrap={wrapRef.current} />}
        {conHover && <ConflictTooltip hover={conHover} wrap={wrapRef.current} />}
      </div>

      {satsActive && satOwners.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3">
          {satOwners.map((o) => (
            <span
              key={o}
              className="flex items-center gap-1.5 text-[0.62rem] uppercase tracking-[0.18em] font-display text-ink/70"
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: SAT_OWNERS[o].color, boxShadow: '0 0 0 1px #1c1208' }}
              />
              {SAT_OWNERS[o].label} · {SAT_OWNERS[o].country}
            </span>
          ))}
        </div>
      )}

      {depsActive && depOwners.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3">
          <span className="text-[0.62rem] uppercase tracking-[0.18em] font-display text-ink/45">
            forces abroad ·
          </span>
          {depOwners.slice(0, 8).map((name) => (
            <span
              key={name}
              className="flex items-center gap-1.5 text-[0.62rem] uppercase tracking-[0.18em] font-display text-ink/70"
            >
              <span
                className="inline-block w-3.5 h-1 rounded-full"
                style={{ backgroundColor: deployerColor(name), boxShadow: '0 0 0 1px #1c1208' }}
              />
              {shortName(name)}
            </span>
          ))}
          {depOwners.length > 8 && (
            <span className="text-[0.62rem] uppercase tracking-[0.18em] font-display text-ink/45">
              +{depOwners.length - 8} more
            </span>
          )}
        </div>
      )}

      {flightsActive && flightCats.order.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3">
          <span className="text-[0.62rem] uppercase tracking-[0.18em] font-display text-ink/45">
            in the air · {flights.length} mil. aircraft ·
          </span>
          {flightCats.order.map((cat) => (
            <span
              key={cat}
              className="flex items-center gap-1.5 text-[0.62rem] uppercase tracking-[0.18em] font-display text-ink/70"
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: FLIGHT_CATS[cat].color, boxShadow: '0 0 0 1px #1c1208' }}
              />
              {FLIGHT_CATS[cat].label} · {flightCats.count.get(cat) ?? 0}
            </span>
          ))}
        </div>
      )}

      {conflictsActive && conCats.order.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3">
          <span className="text-[0.62rem] uppercase tracking-[0.18em] font-display text-ink/45">
            flashpoints · {cons.length}
            {conWindowHours ? ` · last ${conWindowHours}h` : ''} ·
          </span>
          {conCats.order.map((cat) => (
            <span
              key={cat}
              className="flex items-center gap-1.5 text-[0.62rem] uppercase tracking-[0.18em] font-display text-ink/70"
            >
              <span
                className="inline-block w-2 h-2 rotate-45"
                style={{ backgroundColor: CONFLICT_CATS[cat].color, boxShadow: '0 0 0 1px #1c1208' }}
              />
              {CONFLICT_CATS[cat].label} · {conCats.count.get(cat) ?? 0}
            </span>
          ))}
        </div>
      )}

      {(updatedAt || satUpdatedAt || depUpdatedAt || flightsAt || conUpdatedAt) && (
        <div className="mt-2 text-[0.6rem] uppercase tracking-[0.25em] text-ink/40 font-display">
          {updatedAt && <>force data · {new Date(updatedAt).toLocaleDateString()}</>}
          {updatedAt && (satUpdatedAt || depUpdatedAt || flightsAt || conUpdatedAt) && ' · '}
          {satUpdatedAt && <>orbits · {new Date(satUpdatedAt).toLocaleDateString()}</>}
          {satUpdatedAt && (depUpdatedAt || flightsAt || conUpdatedAt) && ' · '}
          {depUpdatedAt && <>deployments · {new Date(depUpdatedAt).toLocaleDateString()}</>}
          {depUpdatedAt && (flightsAt || conUpdatedAt) && ' · '}
          {flightsAt && <>flights · live</>}
          {flightsAt && conUpdatedAt && ' · '}
          {conUpdatedAt && <>conflicts · {new Date(conUpdatedAt).toLocaleDateString()}</>}
        </div>
      )}
    </div>
  );
}

function ForcesTooltip({ hover, wrap }: { hover: Hover; wrap: HTMLDivElement | null }) {
  const { c, x, y } = hover;
  const mil = c.mil;
  const width = wrap?.clientWidth ?? 0;
  const flipX = x > width - 250;
  const rows: ReactNode[] = [];
  if (mil) {
    for (const m of METRICS) {
      const v = mil[m.key as keyof MilitaryRecord] as number | undefined;
      if (typeof v !== 'number' || v <= 0) continue;
      rows.push(
        <div key={m.key} className="flex items-center gap-2 text-parchment">
          <span className="text-parchment/70">
            <UnitIcon kind={m.key} />
          </span>
          <span className="flex-1 text-[0.7rem] tracking-wide text-parchment/85">{m.label}</span>
          <span className="font-mono text-sm font-semibold tabular-nums text-parchment">{compact(v)}</span>
        </div>,
      );
    }
  }

  return (
    <div
      className="pointer-events-none absolute z-20 w-[220px] parchment-dark rounded-md border border-ink/30 shadow-lg p-3"
      style={{
        left: flipX ? undefined : x + 14,
        right: flipX ? width - x + 14 : undefined,
        top: Math.max(4, y - 10),
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        {c.flag && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={flagUrl(c.flag)}
            alt=""
            className="w-6 h-4 object-cover rounded-sm border border-ink/30"
          />
        )}
        <div className="font-display text-sm tracking-[0.12em] text-parchment leading-tight">{c.name}</div>
      </div>
      {rows.length > 0 ? (
        <div className="flex flex-col gap-1.5">{rows}</div>
      ) : (
        <div className="text-[0.7rem] text-parchment/60 italic">No force data on file.</div>
      )}
    </div>
  );
}

function ConflictTooltip({ hover, wrap }: { hover: ConHover; wrap: HTMLDivElement | null }) {
  const { ev, x, y } = hover;
  const cat = catForRoot(ev.root);
  const width = wrap?.clientWidth ?? 0;
  const flipX = x > width - 230;
  return (
    <div
      className="pointer-events-none absolute z-20 w-[210px] parchment-dark rounded-md border border-ink/30 shadow-lg p-2.5"
      style={{
        left: flipX ? undefined : x + 14,
        right: flipX ? width - x + 14 : undefined,
        top: Math.max(4, y - 10),
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="inline-block w-2.5 h-2.5 rotate-45"
          style={{ backgroundColor: CONFLICT_CATS[cat].color, boxShadow: '0 0 0 1px #1c1208' }}
        />
        <span className="font-display text-xs tracking-[0.12em] text-parchment">{CONFLICT_CATS[cat].label}</span>
      </div>
      <div className="text-[0.74rem] text-parchment/90 leading-snug">{ev.place || 'Unknown location'}</div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.6rem] uppercase tracking-[0.12em] text-parchment/65 font-display">
        <span>{compact(ev.mentions)} mentions</span>
        <span>{ev.events} events</span>
        <span>tone {ev.tone}</span>
      </div>
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
