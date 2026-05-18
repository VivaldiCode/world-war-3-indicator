import { NextResponse } from 'next/server';
import { refreshAll } from '@/lib/refresh';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1';
  const composite = await refreshAll(force);
  return NextResponse.json(composite, {
    headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
  });
}

export async function GET(req: Request) {
  return POST(req);
}
