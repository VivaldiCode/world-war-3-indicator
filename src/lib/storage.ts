import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { CompositeIndex, SourceReading } from './types';

const DATA_DIR = process.env.WW3_DATA_DIR
  ? path.resolve(process.env.WW3_DATA_DIR)
  : path.resolve(process.cwd(), 'data');

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const dbPath = path.join(DATA_DIR, 'ww3.db');
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS readings (
      source_id   TEXT NOT NULL,
      measured_at TEXT NOT NULL,
      score       REAL NOT NULL,
      band        TEXT NOT NULL,
      raw         TEXT,
      raw_unit    TEXT,
      rationale   TEXT,
      ok          INTEGER NOT NULL,
      error       TEXT,
      meta        TEXT,
      PRIMARY KEY (source_id, measured_at)
    );
    CREATE INDEX IF NOT EXISTS idx_readings_source ON readings(source_id, measured_at DESC);

    CREATE TABLE IF NOT EXISTS composites (
      computed_at TEXT PRIMARY KEY,
      score       REAL NOT NULL,
      band        TEXT NOT NULL,
      payload     TEXT NOT NULL
    );
  `);
  return _db;
}

export function saveReading(r: SourceReading): void {
  const stmt = db().prepare(
    `INSERT OR REPLACE INTO readings
      (source_id, measured_at, score, band, raw, raw_unit, rationale, ok, error, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  stmt.run(
    r.sourceId,
    r.measuredAt,
    r.score,
    r.band,
    r.raw == null ? null : String(r.raw),
    r.rawUnit ?? null,
    r.rationale,
    r.ok ? 1 : 0,
    r.error ?? null,
    r.meta ? JSON.stringify(r.meta) : null,
  );
}

export function latestReading(sourceId: string): SourceReading | null {
  const row = db()
    .prepare(
      `SELECT source_id, measured_at, score, band, raw, raw_unit, rationale, ok, error, meta
       FROM readings WHERE source_id = ? ORDER BY measured_at DESC LIMIT 1`,
    )
    .get(sourceId) as
    | {
        source_id: string;
        measured_at: string;
        score: number;
        band: string;
        raw: string | null;
        raw_unit: string | null;
        rationale: string;
        ok: number;
        error: string | null;
        meta: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    sourceId: row.source_id,
    measuredAt: row.measured_at,
    score: row.score,
    band: row.band as SourceReading['band'],
    raw: row.raw == null ? null : isNaN(Number(row.raw)) ? row.raw : Number(row.raw),
    rawUnit: row.raw_unit ?? undefined,
    rationale: row.rationale,
    ok: row.ok === 1,
    error: row.error ?? undefined,
    meta: row.meta ? (JSON.parse(row.meta) as Record<string, unknown>) : undefined,
  };
}

export function readingHistory(sourceId: string, limit = 90): SourceReading[] {
  const rows = db()
    .prepare(
      `SELECT source_id, measured_at, score, band, raw, raw_unit, rationale, ok, error, meta
       FROM readings WHERE source_id = ? ORDER BY measured_at DESC LIMIT ?`,
    )
    .all(sourceId, limit) as Array<{
      source_id: string;
      measured_at: string;
      score: number;
      band: string;
      raw: string | null;
      raw_unit: string | null;
      rationale: string;
      ok: number;
      error: string | null;
      meta: string | null;
    }>;
  return rows.map((row) => ({
    sourceId: row.source_id,
    measuredAt: row.measured_at,
    score: row.score,
    band: row.band as SourceReading['band'],
    raw: row.raw == null ? null : isNaN(Number(row.raw)) ? row.raw : Number(row.raw),
    rawUnit: row.raw_unit ?? undefined,
    rationale: row.rationale,
    ok: row.ok === 1,
    error: row.error ?? undefined,
    meta: row.meta ? (JSON.parse(row.meta) as Record<string, unknown>) : undefined,
  }));
}

export function saveComposite(c: CompositeIndex): void {
  db().prepare(
    `INSERT OR REPLACE INTO composites (computed_at, score, band, payload)
     VALUES (?, ?, ?, ?)`,
  ).run(c.computedAt, c.score, c.band, JSON.stringify(c));
}

export function latestComposite(): CompositeIndex | null {
  const row = db()
    .prepare(`SELECT payload FROM composites ORDER BY computed_at DESC LIMIT 1`)
    .get() as { payload: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.payload) as CompositeIndex;
}

export function compositeHistory(limit = 90): Array<{ computedAt: string; score: number; band: string }> {
  return db()
    .prepare(
      `SELECT computed_at as computedAt, score, band FROM composites
       ORDER BY computed_at DESC LIMIT ?`,
    )
    .all(limit) as Array<{ computedAt: string; score: number; band: string }>;
}
