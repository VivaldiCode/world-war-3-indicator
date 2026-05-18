import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import type { SourceReading, CompositeIndex } from './types';

/**
 * Postgres time-series storage.
 *
 * SQLite stores the *latest* reading per source for the live page.
 * Postgres stores the *full historical series* — backfilled from public
 * datasets where possible (going back as far as WW2's end on 1945-09-02
 * where the publisher has data), and appended to on every refresh.
 *
 * The pool is created lazily and only if DATABASE_URL is set. Without it the
 * helpers silently no-op so dev environments without Postgres still work.
 */

let _pool: Pool | null = null;
let _initialized = false;
let _initPromise: Promise<void> | null = null;

function url(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL;
}

export function timeseriesEnabled(): boolean {
  return Boolean(url());
}

function pool(): Pool | null {
  const u = url();
  if (!u) return null;
  if (!_pool) {
    _pool = new Pool({
      connectionString: u,
      max: 5,
      idleTimeoutMillis: 30_000,
      // Most Postgres providers want SSL in prod; allow opt-out via flag.
      ssl: process.env.DATABASE_SSL === 'disable' ? false : undefined,
    });
    _pool.on('error', (err) => {
      console.error('[ww3.timeseries] pg pool error:', err.message);
    });
  }
  return _pool;
}

/**
 * Ensure schema exists. Idempotent — safe to call from every API path.
 */
export async function ensureSchema(): Promise<void> {
  if (_initialized) return;
  if (_initPromise) return _initPromise;
  const p = pool();
  if (!p) return;
  _initPromise = (async () => {
    const client = await p.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS source_readings (
          source_id    TEXT        NOT NULL,
          observed_at  TIMESTAMPTZ NOT NULL,
          raw_value    DOUBLE PRECISION,
          raw_text     TEXT,
          raw_unit     TEXT,
          score        REAL,
          band         TEXT,
          rationale    TEXT,
          meta         JSONB,
          ingested_at  TIMESTAMPTZ DEFAULT now(),
          PRIMARY KEY (source_id, observed_at)
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_source_readings_time ON source_readings (observed_at DESC);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_source_readings_source_time ON source_readings (source_id, observed_at DESC);`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS composite_history (
          computed_at  TIMESTAMPTZ PRIMARY KEY,
          score        REAL NOT NULL,
          band         TEXT NOT NULL,
          payload      JSONB NOT NULL,
          ingested_at  TIMESTAMPTZ DEFAULT now()
        );
      `);

      // A normalised "events" table for sources whose history is sparse
      // (annual releases like SIPRI/GPI, or one-off announcements). The
      // primary `source_readings` table is fine for daily/hourly series.
      await client.query(`
        CREATE TABLE IF NOT EXISTS source_events (
          source_id   TEXT NOT NULL,
          observed_at TIMESTAMPTZ NOT NULL,
          kind        TEXT NOT NULL,
          payload     JSONB NOT NULL,
          ingested_at TIMESTAMPTZ DEFAULT now(),
          PRIMARY KEY (source_id, observed_at, kind)
        );
      `);
      _initialized = true;
    } finally {
      client.release();
    }
  })();
  return _initPromise;
}

/**
 * Insert one reading. Existing (source_id, observed_at) is overwritten so
 * scoring rule changes propagate cleanly when a backfill is re-run.
 */
export async function tsInsertReading(r: SourceReading): Promise<void> {
  const p = pool();
  if (!p) return;
  await ensureSchema();
  const numericRaw = typeof r.raw === 'number' ? r.raw : null;
  const textRaw = typeof r.raw === 'string' ? r.raw : null;
  await p.query(
    `INSERT INTO source_readings
       (source_id, observed_at, raw_value, raw_text, raw_unit, score, band, rationale, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (source_id, observed_at) DO UPDATE
       SET raw_value = EXCLUDED.raw_value,
           raw_text  = EXCLUDED.raw_text,
           raw_unit  = EXCLUDED.raw_unit,
           score     = EXCLUDED.score,
           band      = EXCLUDED.band,
           rationale = EXCLUDED.rationale,
           meta      = EXCLUDED.meta,
           ingested_at = now()`,
    [
      r.sourceId,
      r.measuredAt,
      numericRaw,
      textRaw,
      r.rawUnit ?? null,
      r.score,
      r.band,
      r.rationale,
      r.meta ? JSON.stringify(r.meta) : null,
    ],
  );
}

/**
 * Bulk-insert N readings inside a single transaction. Much faster than
 * looping `tsInsertReading` — used by the backfill CLI.
 */
export async function tsBulkInsertReadings(readings: SourceReading[]): Promise<number> {
  const p = pool();
  if (!p || readings.length === 0) return 0;
  await ensureSchema();
  const client: PoolClient = await p.connect();
  let n = 0;
  try {
    await client.query('BEGIN');
    for (const r of readings) {
      const numericRaw = typeof r.raw === 'number' ? r.raw : null;
      const textRaw = typeof r.raw === 'string' ? r.raw : null;
      await client.query(
        `INSERT INTO source_readings
           (source_id, observed_at, raw_value, raw_text, raw_unit, score, band, rationale, meta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (source_id, observed_at) DO UPDATE
           SET raw_value = EXCLUDED.raw_value,
               raw_text  = EXCLUDED.raw_text,
               raw_unit  = EXCLUDED.raw_unit,
               score     = EXCLUDED.score,
               band      = EXCLUDED.band,
               rationale = EXCLUDED.rationale,
               meta      = EXCLUDED.meta,
               ingested_at = now()`,
        [
          r.sourceId,
          r.measuredAt,
          numericRaw,
          textRaw,
          r.rawUnit ?? null,
          r.score,
          r.band,
          r.rationale,
          r.meta ? JSON.stringify(r.meta) : null,
        ],
      );
      n++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return n;
}

export async function tsInsertComposite(c: CompositeIndex): Promise<void> {
  const p = pool();
  if (!p) return;
  await ensureSchema();
  await p.query(
    `INSERT INTO composite_history (computed_at, score, band, payload)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (computed_at) DO UPDATE
       SET score = EXCLUDED.score,
           band = EXCLUDED.band,
           payload = EXCLUDED.payload,
           ingested_at = now()`,
    [c.computedAt, c.score, c.band, JSON.stringify(c)],
  );
}

export async function tsLatestRange(sourceId: string): Promise<{ first: string; last: string; count: number } | null> {
  const p = pool();
  if (!p) return null;
  await ensureSchema();
  const r = await p.query(
    `SELECT MIN(observed_at) AS first, MAX(observed_at) AS last, COUNT(*)::int AS count
     FROM source_readings WHERE source_id = $1`,
    [sourceId],
  );
  if (!r.rows[0] || r.rows[0].count === 0) return null;
  return {
    first: r.rows[0].first.toISOString(),
    last: r.rows[0].last.toISOString(),
    count: r.rows[0].count,
  };
}

export async function tsSeries(
  sourceId: string,
  fromIso?: string,
  toIso?: string,
  limit = 10000,
): Promise<Array<{ at: string; raw: number | string | null; score: number; band: string }>> {
  const p = pool();
  if (!p) return [];
  await ensureSchema();
  const conditions = ['source_id = $1'];
  const params: unknown[] = [sourceId];
  if (fromIso) {
    params.push(fromIso);
    conditions.push(`observed_at >= $${params.length}`);
  }
  if (toIso) {
    params.push(toIso);
    conditions.push(`observed_at <= $${params.length}`);
  }
  params.push(limit);
  const r = await p.query(
    `SELECT observed_at, raw_value, raw_text, score, band
     FROM source_readings WHERE ${conditions.join(' AND ')}
     ORDER BY observed_at ASC LIMIT $${params.length}`,
    params,
  );
  return r.rows.map((row) => ({
    at: row.observed_at.toISOString(),
    raw: row.raw_value ?? row.raw_text ?? null,
    score: row.score,
    band: row.band,
  }));
}
