# WW3 Indicator

A modular, data-driven indicator (0–100) of how close the world is to a global
conflict — themed after the board game **RISK**. Composite is rebuilt from
real, public data feeds: commodity markets, conflict event databases, news
sentiment, and structural military signals. Every source is a plugin with its
own weight.

> Not a forecast. Not financial or geopolitical advice. Situational awareness only.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

Optional: one-shot crawl without the server:

```bash
npm run refresh -- --force
```

### Docker

```bash
docker compose up --build
# Open http://localhost:3000
```

The bundled compose file spins up the app **plus a Postgres container** for
the time-series store. SQLite (used for the live "latest snapshot") lives in
`./data/ww3.db`; Postgres data lives in `./data/pg/` (both volume-mounted).

### Historical backfill (Postgres)

The `backfill` script seeds the Postgres time-series store with as much
publisher-shipped history as we can reach — going back to **1949** for SIPRI
world military spending, **1946** for UCDP/PRIO battle deaths, **1990** for
VIX, **2000** for gold, etc. Live-only sources (OpenWeather, n2yo, ACLED,
GDELT, …) have no archive — they simply start filling the table from the
next crawl onward.

```bash
docker compose up -d postgres
DATABASE_URL='postgresql://ww3:ww3@localhost:5433/ww3' DATABASE_SSL=disable \
  npm run backfill
```

You can also re-run a single source:

```bash
npm run backfill -- gold-spot oil-brent --from 2000-01-01
```

### Headless browser (optional)

Some publishers (Vision-of-Humanity, certain Cloudflare-protected pages) only
render their data after JS execution. Playwright is shipped as a dep but the
Chromium binary is *not* downloaded by default to keep installs slim.

```bash
npx playwright install chromium
HEADLESS_ENABLED=1 npm run dev
```

Then import `fetchRenderedHtml` from `@/lib/headless` inside a source plugin
when plain `fetch` won't cut it. The helper handles browser pooling, blocks
heavy resources (images, fonts, media), and tears down ephemeral contexts
between requests.

## Architecture

```
src/
├── app/
│   ├── page.tsx                 # Risk-themed homepage
│   └── api/
│       ├── index/route.ts       # GET  /api/index
│       ├── sources/route.ts     # GET  /api/sources
│       ├── sources/[id]/route.ts
│       ├── refresh/route.ts     # POST /api/refresh[?force=1]
│       ├── history/route.ts
│       └── health/route.ts
├── components/                  # Gauge, RiskMap, SourceCard, RefreshButton
├── instrumentation.ts           # Boots background scheduler on server start
└── lib/
    ├── types.ts                 # DataSource + SourceReading contracts
    ├── scoring.ts               # piecewise + band mapping
    ├── engine.ts                # Composes weighted index
    ├── refresh.ts               # Orchestrates fetch + cache
    ├── scheduler.ts             # In-process periodic refresher
    ├── registry.ts              # Single source-of-truth list
    ├── storage.ts               # better-sqlite3 persistence
    ├── http.ts                  # Fetch helpers + Stooq CSV reader
    └── sources/                 # One file per data source ↓
        ├── gold.ts              # XAU/USD via Stooq
        ├── oil.ts               # Brent (CB.F) via Stooq
        ├── dxy.ts               # USD Index via Stooq
        ├── vix.ts               # ^VIX via Stooq
        ├── btc.ts               # BTC/USD via Stooq
        ├── wheat.ts             # ZW.F via Stooq
        ├── treasury.ts          # US 10Y yield via Stooq
        ├── defense_stocks.ts    # ITA ETF via Stooq
        ├── acled.ts             # ACLED political violence (needs key)
        ├── ucdp.ts              # UCDP fatal-conflict events (open)
        ├── gdelt.ts              # GDELT 2.0 news tone (open)
        ├── globalfirepower.ts   # GFP top-10 PowerIndex (scrape)
        ├── gpi.ts               # Global Peace Index (scrape)
        ├── sipri.ts             # SIPRI global mil spend (scrape)
        ├── n2yo.ts              # Military satellites overhead capitals (key)
        ├── electricitymap.ts    # PT grid fossil reliance (token)
        ├── openweather.ts       # Conflict-zone weather (key)
        └── cloudflare_radar.ts  # Internet attacks + outages (token)
```

### Adding a new data source

1. Drop a file in `src/lib/sources/your_source.ts` that exports a `DataSource`.
2. Add it to `SOURCES` in [`src/lib/registry.ts`](src/lib/registry.ts) with a
   relative weight.
3. That's it — it'll appear on the homepage and at `/api/sources`.

```ts
import type { DataSource } from '../types';
import { fetchJson } from '../http';
import { piecewise, reading } from '../scoring';

export const mySource: DataSource = {
  id: 'my-thing',
  name: 'My New Signal',
  description: '…',
  provider: 'Example.com',
  providerUrl: 'https://example.com',
  category: 'sentiment',  // markets | conflicts | sentiment | military | diplomacy
  weight: 5,
  refreshIntervalSec: 60 * 60,
  unit: 'units',
  scoringExplanation: '…',
  async fetch() {
    const data = await fetchJson<{ value: number }>('https://example.com/api');
    const score = piecewise(data.value, [[0, 0], [50, 50], [100, 100]]);
    return reading({
      sourceId: mySource.id,
      raw: data.value,
      rawUnit: 'units',
      score,
      rationale: `value=${data.value}`,
    });
  },
};
```

## Scoring methodology

Each source publishes a normalised **score** in `[0, 100]` where higher = more
indicative of imminent global conflict, and a **band** (green/yellow/red)
following the Risk-style color code.

The composite is a weight-renormalised average across sources whose latest
fetch succeeded:

```
composite = Σᵢ (weightᵢ / Σⱼ weightⱼ) · scoreᵢ        where i ranges over healthy sources
```

If a scraper temporarily fails, its weight is redistributed across the working
sources so the composite stays interpretable.

Default weights (relative, edit in `src/lib/registry.ts`):

| Source                                  | Category   | Weight |
|----------------------------------------|------------|-------:|
| ACLED political violence (30d)          | conflicts  | 10     |
| Wikipedia ongoing armed conflicts       | conflicts  | 9      |
| Gold spot (XAU/USD)                     | markets    | 9      |
| Brent crude                             | markets    | 9      |
| GDELT war/conflict news tone (24h)      | sentiment  | 7      |
| VIX                                     | markets    | 7      |
| Defense stocks (ITA ETF)                | markets    | 6      |
| GlobalFirepower top-10 PowerIndex       | military   | 6      |
| Global Peace Index                      | military   | 6      |
| Cloudflare Radar attacks + outages      | sentiment  | 6      |
| USD Index (DXY)                         | markets    | 5      |
| Wheat futures                           | markets    | 5      |
| SIPRI global military spending          | military   | 5      |
| US 10Y yield                            | markets    | 4      |
| n2yo military satellites overhead       | military   | 4      |
| Bitcoin (BTC/USD)                       | markets    | 3      |
| OpenWeatherMap conflict-zone weather    | sentiment  | 3      |
| Electricity Maps grid fossil reliance   | markets    | 3      |

## API

All endpoints return JSON, set `Access-Control-Allow-Origin: *`, and disable
HTTP caching.

| Method | Path                              | Purpose |
|--------|-----------------------------------|---------|
| GET    | `/api/index`                      | Current composite + each contributor's score, weight, raw value |
| GET    | `/api/sources`                    | All registered sources + latest reading |
| GET    | `/api/sources/{id}`               | Source detail + 90-point reading history (SQLite) |
| POST   | `/api/refresh?force=1`            | Trigger a full crawl (also accepts GET for convenience) |
| GET    | `/api/history?limit=90`           | Historical composite snapshots (SQLite) |
| GET    | `/api/timeseries/{id}?from=&to=&limit=` | Full historical series for a source (Postgres) |
| GET    | `/api/health`                     | Liveness + per-source freshness/error status |

### Example

```bash
curl -s http://localhost:3000/api/index | jq '{score, band, computedAt}'
```

```json
{
  "score": 54.7,
  "band": "yellow",
  "computedAt": "2026-05-18T13:30:11.402Z"
}
```

## Environment variables

| Var                            | Default            | Notes |
|--------------------------------|--------------------|-------|
| `WW3_DATA_DIR`                 | `./data`           | Where the SQLite DB lives |
| `WW3_REFRESH_INTERVAL_MS`      | `900000` (15 min)  | Background refresh cadence |
| `ACLED_USERNAME` / `ACLED_PASSWORD` | unset         | Enables the ACLED political-violence source (OAuth2 flow) |
| `CLOUDFLARE_API_TOKEN`         | unset              | Free token w/ `radar:read` — enables Cloudflare Radar |
| `N2YO_API_KEY`                 | ships w/ a default | Per-user free key from n2yo.com |
| `ELECTRICITYMAP_TOKEN`         | ships w/ a default | Account-scoped; default is PT-only |
| `ELECTRICITYMAP_ZONE`          | `PT`               | Which grid zone to monitor |
| `OPENWEATHER_API_KEY`          | ships w/ a default | Free key from openweathermap.org (≤2h to activate) |

Any source whose credentials are missing — or whose upstream is rate-limiting
— self-disables; the engine redistributes its weight across healthy sources.
The homepage shows a friendly **standby / cooling off / warming up** badge on
that card instead of leaking the raw upstream error.

## Storage

There are two storage layers, intentionally split:

- **SQLite (`./data/ww3.db`)** — small, always-on. Stores the *latest reading
  per source* + recent composites. This is what the homepage reads.
- **Postgres (`DATABASE_URL`)** — optional, opt-in. Stores the *full time
  series*: backfilled historical points + every fresh reading from the
  scheduler. Designed for analytical queries — composite indexes, JSONB meta
  column, and an `ingested_at` clock distinct from `observed_at` so
  late-arriving / corrected data is preserved.

Schema sketch:

```
source_readings (
  source_id   TEXT,           -- FK-style, lines up with /api/sources
  observed_at TIMESTAMPTZ,    -- the *real* time the data describes
  raw_value   DOUBLE PRECISION,
  raw_text    TEXT,
  raw_unit    TEXT,
  score       REAL,           -- 0..100 normalised at *that* observation
  band        TEXT,           -- 'green' | 'yellow' | 'red'
  rationale   TEXT,
  meta        JSONB,
  ingested_at TIMESTAMPTZ,
  PRIMARY KEY (source_id, observed_at)
);

composite_history (
  computed_at TIMESTAMPTZ PRIMARY KEY,
  score       REAL,
  band        TEXT,
  payload     JSONB
);

source_events (...)  -- annual / one-shot facts (SIPRI releases, GPI editions, …)
```

## Self-hosting

The repo ships two compose files:

- [`docker-compose.yml`](docker-compose.yml) — local dev. Builds the image
  from source, reads credentials from a sibling `.env` (gitignored).
- [`stack.yml`](stack.yml) — production. Pulls a pre-built image from a
  private registry. All credentials come from the orchestrator's env panel.

### Build & push a release image

```bash
WW3_REGISTRY=registry.example.com bin/deploy.sh              # tags :latest + :<git-sha>
WW3_REGISTRY=registry.example.com bin/deploy.sh v0.2.0       # also :v0.2.0
```

The script runs `docker build --platform=linux/amd64 → tag → push` for each
tag. Override `WW3_PLATFORM` if your runtime is something other than
`linux/amd64`, or `WW3_IMAGE_NAME` if you want a different image name inside
the registry.

If your registry serves plain HTTP (no TLS), declare it as an insecure
registry on **every** Docker daemon that pushes or pulls from it — otherwise
the daemon refuses with `http: server gave HTTP response to HTTPS client`:

```bash
sudo tee /etc/docker/daemon.json >/dev/null <<'JSON'
{ "insecure-registries": ["registry.example.com"] }
JSON
sudo systemctl restart docker
# macOS / Windows: Docker Desktop → Settings → Docker Engine → edit the JSON.
```

### Deploy `stack.yml`

Point your container orchestrator at `stack.yml` and fill its environment
panel with the variables documented in [`.env.example`](.env.example). The
file reads:

| Var                       | Required | Notes |
|---------------------------|----------|-------|
| `WW3_REGISTRY`            | yes      | registry host (no trailing slash) the image is pulled from |
| `WW3_IMAGE_TAG`           | no       | default `latest` |
| `WW3_PORT`                | no       | host port published, default `3000` |
| `POSTGRES_PASSWORD`       | **yes**  | the stack refuses to start without it |
| `POSTGRES_USER`/`POSTGRES_DB` | no   | defaults `ww3` / `ww3` |
| `WW3_REFRESH_INTERVAL_MS` | no       | scheduler cadence, default 15 min |
| `ACLED_USERNAME` / `ACLED_PASSWORD`  | yes\* | enables ACLED |
| `CLOUDFLARE_API_TOKEN`    | yes\*    | enables Cloudflare Radar |
| `N2YO_API_KEY`            | yes\*    | enables satellite tracking |
| `ELECTRICITYMAP_TOKEN`    | yes\*    | enables grid signal |
| `ELECTRICITYMAP_ZONE`     | no       | default `PT` |
| `OPENWEATHER_API_KEY`     | yes\*    | enables conflict-weather |
| `LIVEUAMAP_API_KEY`       | yes\*    | enables Liveuamap live conflict events (endpoint URL also needs to be set in [`src/lib/sources/liveuamap.ts`](src/lib/sources/liveuamap.ts) — copy from `me.liveuamap.com/devapi`) |

\* Optional — each missing credential simply parks that source in the
"awaiting credentials" state and its weight gets redistributed across the
healthy sources.

### Persistent data

Two named Docker volumes are declared in `stack.yml`:

- `ww3_pg_data` — Postgres data dir (the historical time series).
- `ww3_data`    — the app's SQLite snapshot + any cached files.

Both survive stack updates. Back them up before tearing the stack down.

## License

MIT — see `LICENSE`.
