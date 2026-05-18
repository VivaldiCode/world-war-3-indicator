import { refreshAll } from './refresh';

let started = false;

/**
 * Lightweight in-process scheduler. Next.js doesn't have a "main" entry point
 * we can rely on for background work — so we lazily start a periodic refresh
 * the first time the API is touched. Idempotent.
 */
export function startScheduler(): void {
  if (started) return;
  started = true;
  const intervalMs = Number(process.env.WW3_REFRESH_INTERVAL_MS ?? 15 * 60 * 1000);
  console.log(`[ww3] scheduler started — refresh every ${intervalMs / 1000}s`);
  // Kick off an initial refresh shortly after boot
  setTimeout(() => {
    refreshAll().catch((err) => console.error('[ww3] initial refresh failed:', err));
  }, 2_000);
  setInterval(() => {
    refreshAll().catch((err) => console.error('[ww3] scheduled refresh failed:', err));
  }, intervalMs).unref();
}
