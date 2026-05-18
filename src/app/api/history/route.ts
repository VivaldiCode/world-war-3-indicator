import { NextResponse } from 'next/server';
import { compositeHistory } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') ?? 90);
  return NextResponse.json(
    { history: compositeHistory(limit) },
    { headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } },
  );
}
