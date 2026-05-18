import { NextResponse } from 'next/server';
import { getSource } from '@/lib/registry';
import { latestReading, readingHistory } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const source = getSource(id);
  if (!source) {
    return NextResponse.json({ error: `Unknown source '${id}'` }, { status: 404 });
  }
  return NextResponse.json(
    {
      source: {
        id: source.id,
        name: source.name,
        description: source.description,
        provider: source.provider,
        providerUrl: source.providerUrl,
        category: source.category,
        weight: source.weight,
        refreshIntervalSec: source.refreshIntervalSec,
        unit: source.unit,
        scoringExplanation: source.scoringExplanation,
      },
      latest: latestReading(id),
      history: readingHistory(id, 90),
    },
    { headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } },
  );
}
