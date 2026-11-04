import { createHash, timingSafeEqual } from 'node:crypto';
import { TOOLS, ToolInputError, type McpData } from './tools';

/**
 * Minimal MCP server over streamable HTTP: stateless, JSON responses only and
 * read-only tools. It needs no SDK, so the image gains no dependency.
 */
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'ww3-indicator', version: '0.1.0' };

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

type RpcId = string | number | null;

function rpcResult(id: RpcId, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: RpcId, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function callTool(id: RpcId, params: Record<string, unknown>, data: McpData) {
  const tool = TOOLS.find((t) => t.name === params.name);
  if (!tool) return rpcError(id, INVALID_PARAMS, `Unknown tool: ${String(params.name)}`);
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  try {
    const output = tool.run(data, args);
    return rpcResult(id, {
      content: [{ type: 'text', text: JSON.stringify(output) }],
      structuredContent: output,
    });
  } catch (err) {
    if (!(err instanceof ToolInputError)) console.error(`[ww3.mcp] ${tool.name} failed:`, err);
    const message = err instanceof ToolInputError ? err.message : 'Erro interno ao ler os dados.';
    return rpcResult(id, { content: [{ type: 'text', text: message }], isError: true });
  }
}

/** Handles one JSON-RPC message. Returns null when no response is due. */
export function handleRpc(message: unknown, data: McpData) {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return rpcError(null, INVALID_REQUEST, 'Expected a single JSON-RPC message');
  }
  const { jsonrpc, id, method, params, result, error } = message as Record<string, unknown>;
  if (jsonrpc !== '2.0') return rpcError(null, INVALID_REQUEST, 'Expected jsonrpc 2.0');
  if (method === undefined && (result !== undefined || error !== undefined)) return null; // A response from the client.
  if (typeof method !== 'string') return rpcError(null, INVALID_REQUEST, 'Missing method');
  if (id === undefined) return null; // A notification.
  if (typeof id !== 'string' && typeof id !== 'number' && id !== null) {
    return rpcError(null, INVALID_REQUEST, 'Invalid id');
  }
  const p = (typeof params === 'object' && params !== null ? params : {}) as Record<string, unknown>;

  switch (method) {
    case 'initialize': {
      const requested = p.protocolVersion;
      return rpcResult(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(requested as string)
          ? requested
          : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions:
          'Só leitura. Para a tensão global usar ww3_tensao_global e confirmar `valid` e `computedAt` antes de decidir com o valor.',
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, {
        tools: TOOLS.map(({ name, title, description, inputSchema }) => ({
          name,
          title,
          description,
          inputSchema,
          annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        })),
      });
    case 'tools/call':
      return callTool(id, p, data);
    default:
      return rpcError(id, METHOD_NOT_FOUND, `Unknown method: ${method}`);
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function tokenMatches(header: string | null, token: string): boolean {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return match !== null && timingSafeEqual(digest(match[1]), digest(token));
}

const NO_STORE = { 'Cache-Control': 'no-store' };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export interface McpHttpConfig {
  token: string | undefined;
  allowedOrigins: string[];
}

export function mcpConfigFromEnv(env: Record<string, string | undefined> = process.env): McpHttpConfig {
  return {
    token: env.WW3_MCP_TOKEN || undefined,
    allowedOrigins: (env.WW3_MCP_ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
  };
}

/**
 * The HTTP side of the MCP endpoint. Without a configured token the endpoint
 * stays closed: there is no anonymous mode.
 */
export async function handleMcpPost(
  req: Request,
  config: McpHttpConfig,
  getData: () => McpData | Promise<McpData>,
): Promise<Response> {
  if (!config.token) return jsonResponse({ error: 'MCP is disabled: WW3_MCP_TOKEN is not set' }, 503);

  const origin = req.headers.get('origin');
  if (origin && !config.allowedOrigins.includes(origin)) {
    return jsonResponse({ error: 'Origin not allowed' }, 403);
  }
  if (!tokenMatches(req.headers.get('authorization'), config.token)) {
    return jsonResponse({ error: 'Unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' });
  }

  let message: unknown;
  try {
    message = await req.json();
  } catch {
    return jsonResponse(rpcError(null, PARSE_ERROR, 'Invalid JSON'), 400);
  }
  const response = handleRpc(message, await getData());
  if (response === null) return new Response(null, { status: 202, headers: NO_STORE });
  return jsonResponse(response);
}

/** GET (server-sent events) and DELETE (sessions) are not offered. */
export function mcpMethodNotAllowed(): Response {
  return jsonResponse({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
}
