import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CompositeIndex, SourceReading } from '../types';
import { handleMcpPost, handleRpc, mcpConfigFromEnv, mcpMethodNotAllowed } from './server';
import type { McpData, SourceMeta } from './tools';

const NOW = Date.parse('2026-11-04T10:00:00.000Z');
const MINUTE = 60 * 1000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function meta(id: string, weight: number): SourceMeta {
  return {
    id,
    name: id.toUpperCase(),
    description: `${id} description`,
    provider: 'test',
    providerUrl: 'https://example.test',
    category: id === 'oil' ? 'markets' : 'conflicts',
    weight,
    refreshIntervalSec: 3600,
    scoringExplanation: 'test',
  };
}

function contributor(id: string, ok: boolean, contribution: number): CompositeIndex['contributors'][number] {
  return {
    sourceId: id,
    name: id.toUpperCase(),
    category: id === 'oil' ? 'markets' : 'conflicts',
    weight: ok ? 1 : 0,
    score: ok ? contribution : 0,
    band: 'yellow',
    contribution,
    raw: 1,
    rationale: 'because',
    measuredAt: iso(10 * MINUTE),
    ok,
    error: ok ? undefined : 'HTTP 500',
  };
}

function composite(overrides: Partial<CompositeIndex> = {}): CompositeIndex {
  return {
    score: 54.58251581511751,
    band: 'yellow',
    computedAt: iso(5 * MINUTE),
    contributors: [contributor('acled', false, 0), contributor('oil', true, 54.58)],
    categories: {
      markets: { score: 54.58, weight: 1, band: 'yellow' },
      conflicts: { score: 0, weight: 0, band: 'green' },
      sentiment: { score: 0, weight: 0, band: 'green' },
      military: { score: 0, weight: 0, band: 'green' },
      diplomacy: { score: 0, weight: 0, band: 'green' },
    },
    ...overrides,
  };
}

function reading(id: string, msAgo: number, ok = true): SourceReading {
  return {
    sourceId: id,
    score: 50,
    raw: 80,
    band: 'yellow',
    rationale: 'because',
    measuredAt: iso(msAgo),
    ok,
    error: ok ? undefined : 'HTTP 500',
    meta: { big: 'payload' },
  };
}

function fakeData(overrides: Partial<McpData> = {}): McpData {
  return {
    now: () => NOW,
    refreshIntervalMs: 15 * MINUTE,
    sources: [meta('oil', 3), meta('acled', 1)],
    latestComposite: () => composite(),
    compositeHistory: (limit) =>
      Array.from({ length: Math.min(limit, 2000) }, (_, i) => ({
        computedAt: iso(i * 15 * MINUTE),
        score: 50,
        band: 'yellow',
      })),
    latestReading: (id) => (id === 'oil' ? reading('oil', 10 * MINUTE) : reading('acled', 20 * MINUTE, false)),
    readingHistory: (id, limit) =>
      [reading(id, 20 * MINUTE, false), reading(id, 3 * 60 * MINUTE)].slice(0, limit),
    ...overrides,
  };
}

function callTool(name: string, args: Record<string, unknown> = {}, data = fakeData()) {
  const res = handleRpc(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    data,
  ) as { result: { structuredContent: any; content: Array<{ text: string }>; isError?: boolean } };
  return res.result;
}

describe('ww3_tensao_global', () => {
  it('exposes the value, the last update time and what failed', () => {
    const out = callTool('ww3_tensao_global').structuredContent;
    assert.equal(out.score, 54.58251581511751);
    assert.equal(out.scoreDisplay, 54.6);
    assert.equal(out.computedAt, '2026-11-04T09:55:00.000Z');
    assert.equal(out.ageSeconds, 300);
    assert.equal(out.band, 'yellow');
    assert.equal(out.valid, true);
    assert.equal(out.invalidReason, null);
    assert.equal(out.okSources, 1);
    assert.equal(out.totalSources, 2);
    assert.equal(out.weightCoverage, 0.75);
    assert.deepEqual(out.failedSources, [{ id: 'acled', name: 'ACLED', error: 'HTTP 500' }]);
  });

  it('marks an old composite as invalid but keeps its value', () => {
    const data = fakeData({ latestComposite: () => composite({ computedAt: iso(46 * MINUTE) }) });
    const out = callTool('ww3_tensao_global', {}, data).structuredContent;
    assert.equal(out.score, 54.58251581511751);
    assert.equal(out.fresh, false);
    assert.equal(out.valid, false);
    assert.equal(out.invalidReason, 'stale_composite');
  });

  it('accepts a composite at the staleness limit', () => {
    const data = fakeData({ latestComposite: () => composite({ computedAt: iso(45 * MINUTE) }) });
    assert.equal(callTool('ww3_tensao_global', {}, data).structuredContent.valid, true);
  });

  it('does not present score 0 as peace when no source answered', () => {
    const data = fakeData({
      latestComposite: () =>
        composite({
          score: 0,
          band: 'green',
          contributors: [contributor('acled', false, 0), contributor('oil', false, 0)],
        }),
    });
    const out = callTool('ww3_tensao_global', {}, data).structuredContent;
    assert.equal(out.valid, false);
    assert.equal(out.invalidReason, 'no_ok_sources');
    assert.equal(out.weightCoverage, 0);
  });

  it('answers with nulls before the first composite', () => {
    const data = fakeData({ latestComposite: () => null });
    const out = callTool('ww3_tensao_global', {}, data).structuredContent;
    assert.equal(out.score, null);
    assert.equal(out.computedAt, null);
    assert.equal(out.valid, false);
    assert.equal(out.invalidReason, 'no_composite');
  });
});

describe('ww3_indicadores', () => {
  it('sorts by contribution and reports the age and the error', () => {
    const out = callTool('ww3_indicadores').structuredContent;
    assert.deepEqual(out.indicadores.map((i: { sourceId: string }) => i.sourceId), ['oil', 'acled']);
    assert.equal(out.indicadores[0].ageSeconds, 600);
    assert.equal(out.indicadores[1].error, 'HTTP 500');
  });

  it('filters by category', () => {
    const out = callTool('ww3_indicadores', { categoria: 'markets' }).structuredContent;
    assert.deepEqual(out.indicadores.map((i: { sourceId: string }) => i.sourceId), ['oil']);
  });

  it('refuses an unknown category as a tool error', () => {
    const out = callTool('ww3_indicadores', { categoria: 'nope' });
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /markets/);
  });
});

describe('ww3_indicador', () => {
  it('returns the source and a compact history', () => {
    const out = callTool('ww3_indicador', { id: 'oil' }).structuredContent;
    assert.equal(out.scoringExplanation, 'test');
    assert.equal(out.latest.raw, 80);
    assert.equal(out.history.length, 2);
    assert.deepEqual(Object.keys(out.history[0]), ['measuredAt', 'score', 'band', 'raw', 'ok']);
  });

  it('never exposes the fetch function of a live source', () => {
    const source = { ...meta('oil', 1), fetch: async () => reading('oil', 0) };
    const out = callTool('ww3_indicador', { id: 'oil' }, fakeData({ sources: [source] }));
    assert.equal('fetch' in out.structuredContent, false);
  });

  it('lists the valid ids for an unknown one', () => {
    const out = callTool('ww3_indicador', { id: 'nope' });
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /oil, acled/);
  });

  it('refuses a limit that is not a positive integer', () => {
    assert.equal(callTool('ww3_indicador', { id: 'oil', limite: 0 }).isError, true);
    assert.equal(callTool('ww3_indicador', { id: 'oil', limite: '5' }).isError, true);
  });
});

describe('ww3_historico', () => {
  it('uses the default and caps the limit', () => {
    assert.equal(callTool('ww3_historico').structuredContent.history.length, 90);
    assert.equal(callTool('ww3_historico', { limite: 3 }).structuredContent.history.length, 3);
    assert.equal(callTool('ww3_historico', { limite: 5000 }).structuredContent.history.length, 1000);
  });
});

describe('ww3_frescura', () => {
  it('reports each source against its own interval', () => {
    const out = callTool('ww3_frescura').structuredContent;
    assert.equal(out.refreshIntervalSeconds, 900);
    const [oil, acled] = out.sources;
    assert.equal(oil.fresh, true);
    assert.equal(oil.staleAfterSeconds, 8100);
    assert.equal(oil.lastOkAt, '2026-11-04T09:50:00.000Z');
    assert.equal(acled.ok, false);
    assert.equal(acled.fresh, false);
    assert.equal(acled.error, 'HTTP 500');
    assert.equal(acled.lastOkAt, '2026-11-04T07:00:00.000Z');
  });

  it('marks an OK reading past its limit as stale', () => {
    const data = fakeData({ latestReading: (id) => reading(id, 3 * 60 * MINUTE) });
    assert.equal(callTool('ww3_frescura', {}, data).structuredContent.sources[0].fresh, false);
  });
});

describe('JSON-RPC', () => {
  const rpc = (message: unknown) => handleRpc(message, fakeData()) as any;

  it('negotiates the protocol version', () => {
    const known = rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
    assert.equal(known.result.protocolVersion, '2025-03-26');
    assert.deepEqual(known.result.capabilities, { tools: {} });
    const unknown = rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    assert.equal(unknown.result.protocolVersion, '2025-06-18');
  });

  it('lists only read-only tools', () => {
    const { tools } = rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }).result;
    assert.deepEqual(tools.map((t: { name: string }) => t.name), [
      'ww3_tensao_global',
      'ww3_indicadores',
      'ww3_indicador',
      'ww3_historico',
      'ww3_frescura',
    ]);
    for (const tool of tools) assert.equal(tool.annotations.readOnlyHint, true);
  });

  it('answers ping and rejects unknown methods and tools', () => {
    assert.deepEqual(rpc({ jsonrpc: '2.0', id: 7, method: 'ping' }).result, {});
    assert.equal(rpc({ jsonrpc: '2.0', id: 1, method: 'nope' }).error.code, -32601);
    const tool = rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nope' } });
    assert.equal(tool.error.code, -32602);
  });

  it('stays silent on notifications and client responses', () => {
    assert.equal(rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
    assert.equal(rpc({ jsonrpc: '2.0', id: 1, result: {} }), null);
  });

  it('rejects malformed messages', () => {
    for (const bad of [null, 1, [], {}, { jsonrpc: '2.0', id: 1 }, { jsonrpc: '1.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: {}, method: 'ping' }]) {
      assert.equal(rpc(bad).error.code, -32600);
    }
  });

  it('hides internal errors from the client', () => {
    const data = fakeData({
      latestComposite: () => {
        throw new Error('/data/ww3.sqlite is locked');
      },
    });
    const original = console.error;
    console.error = () => {};
    try {
      const out = callTool('ww3_tensao_global', {}, data);
      assert.equal(out.isError, true);
      assert.doesNotMatch(out.content[0].text, /sqlite/);
    } finally {
      console.error = original;
    }
  });
});

describe('HTTP', () => {
  const TOKEN = 'test-token';
  const config = { token: TOKEN, allowedOrigins: ['https://ok.test'] };
  const ping = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });

  function post(headers: Record<string, string>, body = ping) {
    return new Request('https://ww3.test/mcp', { method: 'POST', headers, body });
  }
  const notUsed = () => {
    throw new Error('data must not be read here');
  };

  it('is closed without a configured token', async () => {
    const res = await handleMcpPost(post({ Authorization: 'Bearer ' }), { token: undefined, allowedOrigins: [] }, notUsed);
    assert.equal(res.status, 503);
  });

  it('refuses a missing or wrong token without reading data', async () => {
    for (const headers of [
      {},
      { Authorization: 'Bearer wrong' },
      { Authorization: TOKEN },
      { Authorization: `Basic ${TOKEN}` },
      { Authorization: `Bearer ${TOKEN} extra` },
    ]) {
      const res = await handleMcpPost(post(headers as Record<string, string>), config, notUsed);
      assert.equal(res.status, 401);
      assert.equal(res.headers.get('www-authenticate'), 'Bearer');
    }
  });

  it('accepts the right token', async () => {
    const res = await handleMcpPost(post({ Authorization: `bearer ${TOKEN}` }), config, () => fakeData());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    assert.deepEqual(await res.json(), { jsonrpc: '2.0', id: 1, result: {} });
  });

  it('refuses browser origins that are not allowed, even with the token', async () => {
    const bad = post({ Authorization: `Bearer ${TOKEN}`, Origin: 'https://evil.test' });
    assert.equal((await handleMcpPost(bad, config, notUsed)).status, 403);
    const good = post({ Authorization: `Bearer ${TOKEN}`, Origin: 'https://ok.test' });
    assert.equal((await handleMcpPost(good, config, () => fakeData())).status, 200);
  });

  it('answers 400 to invalid JSON and 202 to a notification', async () => {
    const auth = { Authorization: `Bearer ${TOKEN}` };
    const bad = await handleMcpPost(post(auth, '{nope'), config, () => fakeData());
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as { error: { code: number } }).error.code, -32700);
    const note = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const res = await handleMcpPost(post(auth, note), config, () => fakeData());
    assert.equal(res.status, 202);
    assert.equal(await res.text(), '');
  });

  it('offers no event stream', () => {
    const res = mcpMethodNotAllowed();
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'POST');
  });

  it('reads its configuration from the environment', () => {
    assert.deepEqual(mcpConfigFromEnv({ WW3_MCP_TOKEN: '', WW3_MCP_ALLOWED_ORIGINS: ' https://a.test, ,https://b.test' }), {
      token: undefined,
      allowedOrigins: ['https://a.test', 'https://b.test'],
    });
  });
});
