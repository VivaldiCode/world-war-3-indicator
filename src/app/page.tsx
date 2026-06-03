import { ThreatGauge } from '@/components/ThreatGauge';
import { RiskMap, type MapCountry } from '@/components/RiskMap';
import { SourceCard } from '@/components/SourceCard';
import { RefreshButton } from '@/components/RefreshButton';
import { getOrRefresh } from '@/lib/refresh';
import { SOURCES } from '@/lib/registry';
import { COUNTRIES, centroidByName } from '@/lib/worldmap';
import { MILITARY, countryColor } from '@/lib/military';
import type { SourceCategory } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CATEGORY_ORDER: SourceCategory[] = ['conflicts', 'markets', 'sentiment', 'military', 'diplomacy'];
const CATEGORY_TITLE: Record<SourceCategory, string> = {
  conflicts: 'I. Boots on the Ground',
  markets: 'II. The Money War',
  sentiment: 'III. The Narrative Front',
  military: 'IV. Standing Armies',
  diplomacy: 'V. Smoke-Filled Rooms',
};

export default async function Home() {
  const composite = await getOrRefresh();
  const totalWeight = SOURCES.reduce((s, x) => s + x.weight, 0);

  // Build the map payload server-side: projection + colors + military join stay
  // off the client bundle; only serializable strings/numbers cross the wire.
  const mapData: MapCountry[] = COUNTRIES.map((c) => ({
    id: c.id,
    name: c.name,
    d: c.d,
    centroid: centroidByName(c.name) ?? null,
    color: countryColor(c.name),
    mil: MILITARY.countries[c.name] ?? null,
  }));

  return (
    <main className="min-h-screen px-4 sm:px-8 py-10 max-w-7xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <div className="font-display tracking-[0.4em] text-xs text-parchment/60">
            CONFLICT WATCH · BOARD-GAME EDITION
          </div>
          <h1 className="font-display text-4xl sm:text-5xl tracking-wider mt-1">
            WW<span className="band-red">3</span> Indicator
          </h1>
          <p className="text-parchment/80 italic max-w-xl mt-2">
            A modular, weighted 0–100 read on how close the world is to a global conflict —
            stitched together from real, public data feeds. Refresh nightly, watch the dice.
          </p>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-2">
          <RefreshButton />
          <div className="text-[0.65rem] uppercase tracking-[0.3em] text-parchment/50">
            last roll · {new Date(composite.computedAt).toLocaleString()}
          </div>
        </div>
      </header>

      <section className="grid lg:grid-cols-5 gap-6 mb-10">
        <div className="lg:col-span-2 parchment-dark rounded-md p-6 flex flex-col items-center justify-center">
          <ThreatGauge score={composite.score} band={composite.band} />
          <div className="mt-6 text-center text-parchment/80 text-sm max-w-sm">
            Composite of <b>{SOURCES.length}</b> live data sources across{' '}
            <b>{Object.values(composite.categories).filter((c) => c.weight > 0).length}</b>{' '}
            categories. Weights total {totalWeight}; engine renormalises for healthy sources.
          </div>
        </div>
        <div className="lg:col-span-3">
          <RiskMap composite={composite} mapData={mapData} updatedAt={MILITARY.updatedAt} />
        </div>
      </section>

      <section className="mb-12">
        <div className="flex items-end justify-between mb-3">
          <h2 className="font-display text-2xl tracking-[0.2em]">THE BATTLE CARDS</h2>
          <span className="text-[0.65rem] uppercase tracking-[0.3em] text-parchment/50">
            {composite.contributors.filter((c) => c.ok).length}/{composite.contributors.length} sources reporting
          </span>
        </div>

        {CATEGORY_ORDER.map((cat) => {
          const inCat = composite.contributors.filter((c) => c.category === cat);
          if (inCat.length === 0) return null;
          return (
            <div key={cat} className="mb-8">
              <div className="flex items-baseline gap-3 mb-3">
                <h3 className="font-display text-lg tracking-[0.18em] text-parchment">
                  {CATEGORY_TITLE[cat]}
                </h3>
                <span className="text-[0.65rem] uppercase tracking-[0.25em] text-parchment/50">
                  category score · {composite.categories[cat].score.toFixed(1)}
                </span>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {inCat.map((c) => (
                  <SourceCard key={c.sourceId} c={c} />
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section className="parchment-dark rounded-md p-6 mb-12">
        <h2 className="font-display text-xl tracking-[0.2em] mb-3">RULES OF ENGAGEMENT · API</h2>
        <p className="text-parchment/80 mb-4">
          Everything you see is also served as JSON. CORS is open. No auth.
        </p>
        <div className="grid sm:grid-cols-2 gap-3 font-mono text-sm">
          <ApiRow method="GET" path="/api/index" desc="Current composite + every contributor." />
          <ApiRow method="GET" path="/api/sources" desc="All registered sources w/ weights + latest readings." />
          <ApiRow method="GET" path="/api/sources/{id}" desc="Source details + 90-point history." />
          <ApiRow method="POST" path="/api/refresh?force=1" desc="Trigger a crawl across all sources." />
          <ApiRow method="GET" path="/api/history?limit=90" desc="Historical composite scores." />
          <ApiRow method="GET" path="/api/health" desc="Liveness probe + per-source status." />
        </div>
      </section>

      <footer className="text-center text-parchment/40 text-xs tracking-[0.2em] uppercase pb-6">
        Not a forecast. Not financial or geopolitical advice. Built for situational awareness.
      </footer>
    </main>
  );
}

function ApiRow({ method, path, desc }: { method: string; path: string; desc: string }) {
  return (
    <div className="flex flex-col gap-1 p-3 rounded border border-parchment/20">
      <div className="flex items-center gap-2">
        <span
          className={`px-2 py-0.5 rounded text-[0.65rem] tracking-wider font-display ${
            method === 'GET' ? 'bg-band-green' : 'bg-band-yellow'
          }`}
        >
          {method}
        </span>
        <code className="text-parchment">{path}</code>
      </div>
      <span className="text-parchment/70 text-xs">{desc}</span>
    </div>
  );
}
