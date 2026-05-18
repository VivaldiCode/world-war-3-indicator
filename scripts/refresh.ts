#!/usr/bin/env tsx
/**
 * One-shot crawler. Use this to populate the DB without booting the server.
 *   pnpm refresh        # honors per-source intervals
 *   pnpm refresh --force  # re-fetch everything
 */
import { refreshAll } from '../src/lib/refresh';

const force = process.argv.includes('--force');

refreshAll(force)
  .then((c) => {
    console.log(`[ww3] composite = ${c.score.toFixed(2)} (${c.band})`);
    for (const x of c.contributors) {
      const status = x.ok ? '✓' : '✗';
      console.log(
        `  ${status} ${x.sourceId.padEnd(28)} ${x.score.toFixed(1).padStart(6)}  ${x.rationale}`,
      );
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error('[ww3] refresh failed:', err);
    process.exit(1);
  });
