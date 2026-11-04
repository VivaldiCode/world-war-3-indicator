import { SOURCES } from '../registry';
import { compositeHistory, latestComposite, latestReading, readingHistory } from '../storage';
import type { McpData } from './tools';

/** The tools' view of the live store. Reads only: it never triggers a refresh. */
export function liveData(): McpData {
  return {
    now: () => Date.now(),
    refreshIntervalMs: Number(process.env.WW3_REFRESH_INTERVAL_MS ?? 15 * 60 * 1000),
    sources: SOURCES,
    latestComposite,
    compositeHistory,
    latestReading,
    readingHistory,
  };
}
