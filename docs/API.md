# API and MCP reference

The service has a REST API and an MCP server. Both read the same data. Examples
use `$BASE` for the service URL, such as `http://localhost:3000`.

## Global tension

The global tension is the `score` of the latest composite: a weighted average of
all sources that answered, from 0 (peaceful) to 100 (on the brink).

| `band`   | Score    |
|----------|----------|
| `green`  | below 33 |
| `yellow` | 33 to 66 |
| `red`    | 66 or up |

The score is stored at full precision. The page shows one decimal.

Weights are renormalized across the sources that answered, so a failing source
does not pull the score down. **If no source answers, the composite still has
score 0 and band `green`.** That means "no data", not "peace": the REST API does
not flag it, while the MCP tool `ww3_tensao_global` reports it as `valid: false`.

## REST API

Responses are JSON with no HTTP caching. There is no authentication, so keep the
service off the public internet. Only `/api/health` and `/api/flag/{code}` omit
`Access-Control-Allow-Origin: *`.

| Method   | Path                                    | Purpose |
|----------|-----------------------------------------|---------|
| GET      | `/api/index`                            | Latest composite with all contributors and categories |
| GET      | `/api/history?limit=90`                 | Past composites, newest first: `computedAt`, `score`, `band` |
| GET      | `/api/sources`                          | All sources with their latest reading |
| GET      | `/api/sources/{id}`                     | One source, its latest reading and up to 90 past readings |
| GET      | `/api/timeseries/{id}?from=&to=&limit=` | Full series from Postgres; 503 without `DATABASE_URL` |
| GET      | `/api/health`                           | Composite time and, per source, `ok`, `lastMeasuredAt`, `error` |
| POST/GET | `/api/refresh?force=1`                  | Starts a crawl of the sources. **This one writes, and also answers GET** |
| GET      | `/api/flights`                          | Live military flights for the forces map |
| GET      | `/api/flag/{code}`                      | Country flag image |

`GET /api/index` also starts a background refresh when the composite is older
than 15 minutes, and a full crawl if there is no composite yet.

### Composite

```json
{
  "score": 54.58251581511751,
  "band": "yellow",
  "computedAt": "2026-11-04T09:14:29.647Z",
  "contributors": [
    {
      "sourceId": "gold-spot",
      "name": "Gold (XAU/USD)",
      "category": "markets",
      "weight": 0.0989,
      "score": 34.27,
      "band": "yellow",
      "contribution": 3.39,
      "raw": 4035.7,
      "rawUnit": "USD/oz",
      "rationale": "Gold at $4035.70 (-3.6% 30d). Level→44, momentum→16.",
      "measuredAt": "2026-11-04T08:14:29.520Z",
      "ok": true
    }
  ],
  "categories": {
    "markets": { "score": 39.47, "weight": 0.527, "band": "yellow" }
  }
}
```

- `weight` is normalized across the sources that answered; a failed source has 0.
- `contribution` is `weight * score`, and the contributions add up to `score`.
- Categories are `markets`, `conflicts`, `sentiment`, `military` and `diplomacy`.

## Data freshness

There are two clocks, and they mean different things:

- `computedAt` is when the composite was last calculated. The scheduler does it
  every `WW3_REFRESH_INTERVAL_MS` (15 minutes by default), even when no source
  was due. **A recent `computedAt` does not prove the sources are recent.**
- `measuredAt` is when a source was last read. On each tick, a source is read
  again only once its own `refreshIntervalSec` has run out, which ranges from 30
  minutes to 30 days. After a failure, `measuredAt` is the time of the failure.

The MCP server applies these limits. The REST API returns the timestamps only.

| What      | Counts as stale after                                 | Default |
|-----------|-------------------------------------------------------|---------|
| Composite | 3 × `WW3_REFRESH_INTERVAL_MS` (two missed ticks)      | 45 min  |
| Source    | 2 × `refreshIntervalSec` + `WW3_REFRESH_INTERVAL_MS`  | depends |

## MCP server

`POST /mcp` speaks MCP over streamable HTTP: stateless, with JSON responses and
no event stream, so `GET` and `DELETE` answer 405. All tools are read-only, and
none of them starts a refresh.

### Authentication

Send `Authorization: Bearer <token>`, where the token is `WW3_MCP_TOKEN`.

| Situation                          | Answer |
|------------------------------------|--------|
| `WW3_MCP_TOKEN` is not set         | 503: the endpoint stays closed, there is no anonymous mode |
| Missing or wrong token             | 401 |
| `Origin` not in `WW3_MCP_ALLOWED_ORIGINS` | 403. MCP clients normally send no `Origin` |

```bash
curl -s "$BASE/mcp" \
  -H "Authorization: Bearer $WW3_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ww3_tensao_global"}}'
```

### Tools

| Tool                | Arguments                  | Returns |
|---------------------|----------------------------|---------|
| `ww3_tensao_global` | none                       | The global tension and whether it can be trusted |
| `ww3_indicadores`   | `categoria` (optional)     | All contributors, highest contribution first, each with `ageSeconds` |
| `ww3_indicador`     | `id`, `limite` (30, max 90) | One source, how its score is calculated, latest reading and history |
| `ww3_historico`     | `limite` (90, max 1000)    | Past values of the global tension, newest first |
| `ww3_frescura`      | none                       | Age of the composite and of each source, `lastOkAt`, current error |

An unknown id, category or limit returns a tool error (`isError: true`) that
lists the valid values where there is a fixed list.

### `ww3_tensao_global`

Use this one to act on the value. Automations should check `valid` first.

```json
{
  "score": 54.58251581511751,
  "scoreDisplay": 54.6,
  "scale": "0-100",
  "band": "yellow",
  "computedAt": "2026-11-04T09:14:29.647Z",
  "ageSeconds": 312,
  "staleAfterSeconds": 2700,
  "fresh": true,
  "valid": true,
  "invalidReason": null,
  "okSources": 16,
  "totalSources": 19,
  "weightCoverage": 0.81,
  "failedSources": [{ "id": "gdelt-war-tone", "name": "GDELT", "error": "GDELT returned an empty timeline" }],
  "categories": { "markets": { "score": 39.47, "weight": 0.527, "band": "yellow" } }
}
```

| Field            | Meaning |
|------------------|---------|
| `score`          | Full precision; do any rounding from this value |
| `scoreDisplay`   | One decimal, as on the page |
| `computedAt`     | Time of the last update; `null` before the first composite |
| `valid`          | `false` when the value should not drive a decision |
| `invalidReason`  | `no_composite`, `no_ok_sources` or `stale_composite`; otherwise `null` |
| `weightCoverage` | Share of the configured weight, from 0 to 1, that answered |

An old composite keeps its `score` with `valid: false`, so a caller can still see
the last known value. `valid` does not look at `weightCoverage`: a caller that
needs a minimum coverage has to check it.
