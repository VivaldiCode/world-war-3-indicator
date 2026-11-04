import { handleMcpPost, mcpConfigFromEnv, mcpMethodNotAllowed } from '@/lib/mcp/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handleMcpPost(req, mcpConfigFromEnv(), async () => {
    const { liveData } = await import('@/lib/mcp/data');
    return liveData();
  });
}

export const GET = mcpMethodNotAllowed;
export const DELETE = mcpMethodNotAllowed;
