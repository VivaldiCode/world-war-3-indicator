import { SOURCES } from './registry';
import { db } from './storage';
import { ntfy } from './notify';
import { decide, emptyState, type BatteryDecision, type BatteryEvent, type BatteryState } from './battery';
import type { CompositeIndex } from './types';

const MIN_GAP_MS = 10 * 60 * 1000; // one evaluation per ~15 min tick, never twice in a burst

let ready = false;
function ensure(): void {
  if (ready) return;
  db().exec(`
    CREATE TABLE IF NOT EXISTS battery_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS battery_shadow (
      evaluated_at TEXT PRIMARY KEY, score REAL, coverage REAL, valid INTEGER,
      tier INTEGER, reserve INTEGER, hold INTEGER, reason TEXT
    );
  `);
  ready = true;
}

export function loadState(): BatteryState {
  ensure();
  const row = db().prepare('SELECT payload FROM battery_state WHERE id = 1').get() as { payload: string } | undefined;
  return row ? (JSON.parse(row.payload) as BatteryState) : emptyState();
}

function saveState(s: BatteryState): void {
  db().prepare('INSERT OR REPLACE INTO battery_state (id, payload) VALUES (1, ?)').run(JSON.stringify(s));
}

export interface ShadowRow {
  evaluatedAt: string;
  score: number | null;
  coverage: number | null;
  valid: boolean;
  tier: number;
  reserve: number;
  hold: boolean;
  reason: string;
}

export function latestShadow(limit = 1): ShadowRow[] {
  ensure();
  const rows = db()
    .prepare('SELECT * FROM battery_shadow ORDER BY evaluated_at DESC LIMIT ?')
    .all(limit) as Array<Record<string, number | string | null>>;
  return rows.map((r) => ({
    evaluatedAt: String(r.evaluated_at),
    score: r.score as number | null,
    coverage: r.coverage as number | null,
    valid: r.valid === 1,
    tier: Number(r.tier),
    reserve: Number(r.reserve),
    hold: r.hold === 1,
    reason: String(r.reason),
  }));
}

/** Weight share of the sources that currently deliver a usable reading. */
export function weightCoverage(composite: CompositeIndex): number {
  const total = SOURCES.reduce((s, x) => s + x.weight, 0);
  if (total <= 0) return 0;
  const ok = new Set(composite.contributors.filter((c) => c.ok).map((c) => c.sourceId));
  return SOURCES.filter((s) => ok.has(s.id)).reduce((sum, s) => sum + s.weight, 0) / total;
}

function message(ev: BatteryEvent, d: BatteryDecision, score: number): { title: string; body: string; priority: 'default' | 'urgent' } {
  const tail = ' MODO SOMBRA: nada foi escrito na bateria.';
  switch (ev) {
    case 'init':
      return { title: 'WW3 bateria (sombra): arranque', body: `Índice ${score.toFixed(1)}: recomendaria reserva de ${d.reserve} %.${tail}`, priority: 'default' };
    case 'tier_change':
      return { title: `WW3 bateria (sombra): ${d.reserve} %`, body: `Índice ${score.toFixed(1)}: recomendaria passar a ${d.reserve} % (${d.reason}).${tail}`, priority: 'default' };
    case 'hold_2h':
      return { title: 'WW3 bateria (sombra): indicador sem leitura fiável', body: `Há mais de 2 h sem leitura fiável (${d.reason}). Manteria ${d.reserve} %, sem baixar.${tail}`, priority: 'default' };
    case 'hold_24h':
      return { title: 'WW3 bateria (sombra): indicador parado há 24 h', body: `Há mais de 24 h sem leitura fiável (${d.reason}). Ver o ww3-indicator.${tail}`, priority: 'urgent' };
    case 'hold_cleared':
      return { title: 'WW3 bateria (sombra): indicador recuperou', body: `Leitura fiável outra vez, índice ${score.toFixed(1)}; recomenda ${d.reserve} %.${tail}`, priority: 'default' };
  }
}

/** Runs after each composite; never throws. */
export async function runBatteryShadow(composite: CompositeIndex, nowMs = Date.now()): Promise<BatteryDecision | null> {
  try {
    ensure();
    const last = latestShadow(1)[0];
    if (last && nowMs - Date.parse(last.evaluatedAt) < MIN_GAP_MS) return null;
    const coverage = weightCoverage(composite);
    const valid = composite.contributors.some((c) => c.ok) && nowMs - Date.parse(composite.computedAt) < 45 * 60 * 1000;
    const d = decide(loadState(), { score: composite.score, valid, coverage, nowMs });
    saveState(d.state);
    db()
      .prepare('INSERT OR REPLACE INTO battery_shadow (evaluated_at, score, coverage, valid, tier, reserve, hold, reason) VALUES (?,?,?,?,?,?,?,?)')
      .run(new Date(nowMs).toISOString(), composite.score, coverage, valid ? 1 : 0, d.tier, d.reserve, d.hold ? 1 : 0, d.reason);
    db().prepare('DELETE FROM battery_shadow WHERE evaluated_at < ?').run(new Date(nowMs - 30 * 24 * 3600 * 1000).toISOString());
    for (const ev of d.events) {
      const m = message(ev, d, composite.score);
      await ntfy(m.title, m.body, m.priority);
    }
    return d;
  } catch (err) {
    console.warn('[ww3.battery] shadow evaluation failed:', (err as Error).message);
    return null;
  }
}
