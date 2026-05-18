import { NextResponse } from 'next/server';
import { getOrRefresh } from '@/lib/refresh';

export const dynamic = 'force-dynamic';

export async function GET() {
  const composite = await getOrRefresh();
  return NextResponse.json(composite, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
