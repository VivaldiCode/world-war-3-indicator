#!/usr/bin/env tsx
/**
 * One-shot historical backfill into the Postgres time-series store.
 *
 *   pnpm backfill                # every source with a backfill() method
 *   pnpm backfill -- gold-spot oil-brent
 *   pnpm backfill -- --from 1980-01-01
 *
 * The script silently no-ops if DATABASE_URL is not set.
 */
import { SOURCES } from '../src/lib/registry';
import { tsBulkInsertReadings, ensureSchema, timeseriesEnabled } from '../src/lib/timeseries';
import { WW2_END } from '../src/lib/sources/_yahoo_backfill';

async function main() {
  if (!timeseriesEnabled()) {
    console.error('[backfill] DATABASE_URL is not set — nothing to do.');
    console.error('[backfill] Start docker-compose, or export DATABASE_URL=postgresql://...');
    process.exit(2);
  }
  const args = process.argv.slice(2);
  let from: string | undefined;
  let to: string | undefined;
  const ids: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from') from = args[++i];
    else if (args[i] === '--to') to = args[++i];
    else ids.push(args[i]);
  }
  from = from ?? WW2_END;

  await ensureSchema();
  const targets = ids.length === 0 ? SOURCES : SOURCES.filter((s) => ids.includes(s.id));
  const missing = ids.filter((id) => !SOURCES.find((s) => s.id === id));
  if (missing.length > 0) {
    console.error(`[backfill] unknown source ids: ${missing.join(', ')}`);
  }

  let totalRows = 0;
  for (const s of targets) {
    if (!s.backfill) {
      console.log(`  · ${s.id.padEnd(28)}  (no backfill — collects from now on)`);
      continue;
    }
    process.stdout.write(`  · ${s.id.padEnd(28)}  fetching...`);
    try {
      const rs = await s.backfill({ from, to });
      const n = await tsBulkInsertReadings(rs);
      totalRows += n;
      console.log(`\r  ✓ ${s.id.padEnd(28)}  ${String(n).padStart(6)} rows`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`\r  ✗ ${s.id.padEnd(28)}  ${msg.slice(0, 80)}`);
    }
  }
  console.log(`\n[backfill] inserted ${totalRows.toLocaleString()} time-series rows.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[backfill] fatal:', err);
  process.exit(1);
});
