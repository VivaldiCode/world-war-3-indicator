import { NextResponse } from 'next/server';
import { SOURCES } from '@/lib/registry';
import { latestReading } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET() {
  const total = SOURCES.reduce((s, x) => s + x.weight, 0);
  const data = SOURCES.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    provider: s.provider,
    providerUrl: s.providerUrl,
    category: s.category,
    weight: s.weight,
    weightNormalized: s.weight / total,
    refreshIntervalSec: s.refreshIntervalSec,
    unit: s.unit,
    scoringExplanation: s.scoringExplanation,
    latest: latestReading(s.id),
  }));
  return NextResponse.json(
    { sources: data, totalWeight: total },
    { headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } },
  );
}
