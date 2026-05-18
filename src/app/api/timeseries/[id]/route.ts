import { NextResponse } from 'next/server';
import { getSource } from '@/lib/registry';
import { timeseriesEnabled, tsLatestRange, tsSeries } from '@/lib/timeseries';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/timeseries/{sourceId}?from=...&to=...&limit=10000
 *
 * Returns the historical reading series for a single source from the
 * Postgres time-series store. Optional `from` / `to` ISO timestamps narrow
 * the window. Without DATABASE_URL configured, returns 503.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!timeseriesEnabled()) {
    return NextResponse.json(
      {
        error: 'Time-series store not configured.',
        hint: 'Set DATABASE_URL to a Postgres connection string to enable.',
      },
      { status: 503 },
    );
  }
  const source = getSource(id);
  if (!source) {
    return NextResponse.json({ error: `Unknown source '${id}'` }, { status: 404 });
  }
  const url = new URL(req.url);
  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;
  const limit = Math.min(50000, Number(url.searchParams.get('limit') ?? 10000));
  const [range, series] = await Promise.all([
    tsLatestRange(id),
    tsSeries(id, from, to, limit),
  ]);
  return NextResponse.json(
    {
      source: {
        id: source.id,
        name: source.name,
        unit: source.unit,
        category: source.category,
      },
      range,
      count: series.length,
      series,
    },
    { headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } },
  );
}
