import { NextResponse } from 'next/server';
import { latestShadow, loadState } from '@/lib/battery_runner';
import { TIERS, MIN_RESERVE, MAX_RESERVE } from '@/lib/battery';

export const dynamic = 'force-dynamic';

/**
 * Battery reserve RECOMMENDATION (shadow mode, HOMEL-469). Read-only: nothing
 * here, or anywhere in this repo, writes to the battery.
 */
export async function GET() {
  const [latest] = latestShadow(1);
  const state = loadState();
  return NextResponse.json(
    {
      shadow: true,
      writeEnabled: false,
      recommended: latest?.reserve ?? null,
      hold: latest?.hold ?? null,
      reason: latest?.reason ?? 'no evaluation yet',
      score: latest?.score ?? null,
      weightCoverage: latest?.coverage ?? null,
      valid: latest?.valid ?? null,
      evaluatedAt: latest?.evaluatedAt ?? null,
      tierSince: state.sinceMs ? new Date(state.sinceMs).toISOString() : null,
      tiers: TIERS.map((t) => ({ from: Number.isFinite(t.min) ? t.min : null, reserve: t.reserve })),
      limits: { min: MIN_RESERVE, max: MAX_RESERVE },
    },
    { headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } },
  );
}
