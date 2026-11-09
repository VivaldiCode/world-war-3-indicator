import { SOURCES } from './registry';
import { composeIndex, pickEffective, safeFetch } from './engine';
import { latestComposite, latestReading, readingHistory, saveComposite, saveReading } from './storage';
import {
  ensureSchema as ensureTsSchema,
  timeseriesEnabled,
  tsInsertComposite,
  tsInsertReading,
} from './timeseries';
import { runBatteryShadow } from './battery_runner';
import type { CompositeIndex, SourceReading } from './types';

let inFlight: Promise<CompositeIndex> | null = null;
let lastRefreshAt = 0;

/**
 * Refresh every source whose latest reading is older than its
 * refreshIntervalSec, then recompute the composite.
 * Concurrent callers coalesce onto a single in-flight promise.
 */
export async function refreshAll(force = false): Promise<CompositeIndex> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const now = Date.now();
      const tsOn = timeseriesEnabled();
      if (tsOn) {
        await ensureTsSchema().catch((err) => {
          console.warn('[ww3.timeseries] ensureSchema failed:', err.message);
        });
      }
      const readings: Record<string, SourceReading> = {};
      const schedulerSec = Number(process.env.WW3_REFRESH_INTERVAL_MS ?? 15 * 60 * 1000) / 1000;
      const effective = (s: (typeof SOURCES)[number], r: SourceReading): SourceReading =>
        r.ok ? r : pickEffective(r, readingHistory(s.id, 50), s.refreshIntervalSec, schedulerSec, now);
      const tasks = SOURCES.map(async (s) => {
        const latest = latestReading(s.id);
        const ageSec = latest ? (now - Date.parse(latest.measuredAt)) / 1000 : Infinity;
        if (!force && latest && ageSec < s.refreshIntervalSec) {
          readings[s.id] = effective(s, latest);
          return;
        }
        const r = await safeFetch(s);
        saveReading(r);
        readings[s.id] = effective(s, r);
        if (tsOn && r.ok) {
          try {
            await tsInsertReading(r);
          } catch (err) {
            console.warn(`[ww3.timeseries] insert failed for ${s.id}:`, (err as Error).message);
          }
        }
      });
      await Promise.all(tasks);
      const composite = composeIndex(SOURCES, readings);
      saveComposite(composite);
      if (tsOn) {
        try {
          await tsInsertComposite(composite);
        } catch (err) {
          console.warn('[ww3.timeseries] composite insert failed:', (err as Error).message);
        }
      }
      lastRefreshAt = now;
      await runBatteryShadow(composite);
      return composite;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Return the latest composite, refreshing only if there's none cached. */
export async function getOrRefresh(): Promise<CompositeIndex> {
  const cached = latestComposite();
  if (cached) {
    // Trigger a background refresh if the cache is older than 15 minutes
    const ageMs = Date.now() - Date.parse(cached.computedAt);
    if (ageMs > 15 * 60 * 1000 && !inFlight) {
      refreshAll().catch((err) => {
        console.error('[ww3] background refresh failed:', err);
      });
    }
    return cached;
  }
  return refreshAll();
}

export function getLastRefreshAt(): number {
  return lastRefreshAt;
}
