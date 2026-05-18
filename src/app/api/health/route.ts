import { NextResponse } from 'next/server';
import { SOURCES } from '@/lib/registry';
import { latestComposite, latestReading } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET() {
  const composite = latestComposite();
  const sources = SOURCES.map((s) => {
    const r = latestReading(s.id);
    return {
      id: s.id,
      ok: r?.ok ?? false,
      lastMeasuredAt: r?.measuredAt ?? null,
      error: r?.error ?? null,
    };
  });
  return NextResponse.json({
    ok: true,
    compositeAt: composite?.computedAt ?? null,
    sources,
  });
}
