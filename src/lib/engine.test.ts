import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickEffective, refreshDue } from './engine';
import { fetchWithBackoff } from './sources/gdelt';
import type { SourceReading } from './types';

const NOW = Date.parse('2026-11-09T12:00:00.000Z');
const HOUR = 3600 * 1000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function reading(msAgo: number, ok: boolean, score = 60): SourceReading {
  return {
    sourceId: 'gdelt-war-tone',
    score: ok ? score : 0,
    raw: ok ? -2.1 : null,
    band: 'yellow',
    rationale: ok ? 'tone -2.1' : 'Fetch failed',
    measuredAt: iso(msAgo),
    ok,
    error: ok ? undefined : 'HTTP 429',
  };
}

describe('pickEffective', () => {
  const interval = 3600; // 1 h source
  const tick = 900; // 15 min scheduler

  it('returns a good reading untouched', () => {
    const r = reading(0, true);
    assert.equal(pickEffective(r, [r], interval, tick, NOW), r);
  });

  it('keeps the last good reading while inside the staleness window', () => {
    const failed = reading(0, false);
    const out = pickEffective(failed, [failed, reading(2 * HOUR, true, 70)], interval, tick, NOW);
    assert.equal(out.ok, true);
    assert.equal(out.score, 70);
    assert.equal(out.error, 'HTTP 429');
    assert.equal(out.measuredAt, iso(2 * HOUR));
    assert.equal(out.meta?.usedLastGood, true);
  });

  it('drops the source once the last good reading is past 2 intervals + 1 tick', () => {
    const failed = reading(0, false);
    const out = pickEffective(failed, [failed, reading(2.5 * HOUR, true)], interval, tick, NOW);
    assert.equal(out.ok, false);
  });

  it('returns the failure when there has never been a good reading', () => {
    const failed = reading(0, false);
    assert.equal(pickEffective(failed, [failed], interval, tick, NOW).ok, false);
  });
});

describe('gdelt fetchWithBackoff', () => {
  const res = (status: number, body = '', headers: Record<string, string> = {}) =>
    new Response(body, { status, headers });

  it('retries after 429 and honours Retry-After', async () => {
    const waits: number[] = [];
    const calls = [res(429, '', { 'retry-after': '7' }), res(200, '{"ok":1}')];
    const out = await fetchWithBackoff('https://x.test', (async () => calls.shift()!) as typeof fetch, async (ms) => {
      waits.push(ms);
    });
    assert.equal(out, '{"ok":1}');
    assert.deepEqual(waits, [7000]);
  });

  it('treats a 200 "limit requests" body as a rate limit', async () => {
    const calls = [res(200, 'Please limit requests to one every 5 seconds'), res(200, '{"ok":2}')];
    const out = await fetchWithBackoff('https://x.test', (async () => calls.shift()!) as typeof fetch, async () => {});
    assert.equal(out, '{"ok":2}');
  });

  it('gives up after 3 attempts with a rate-limit error', async () => {
    let n = 0;
    await assert.rejects(
      fetchWithBackoff('https://x.test', (async () => (n++, res(429))) as typeof fetch, async () => {}),
      /rate limit.*3\/3/,
    );
    assert.equal(n, 3);
  });

  it('does not retry a plain 404', async () => {
    let n = 0;
    await assert.rejects(
      fetchWithBackoff('https://x.test', (async () => (n++, res(404))) as typeof fetch, async () => {}),
      /HTTP 404/,
    );
    assert.equal(n, 1);
  });
});

describe('refreshDue', () => {
  it('waits the full interval after a good reading', () => {
    assert.equal(refreshDue(reading(30 * 60 * 1000, true), 3600, 900, NOW), false);
    assert.equal(refreshDue(reading(61 * 60 * 1000, true), 3600, 900, NOW), true);
  });
  it('retries a failed reading on the next scheduler tick', () => {
    assert.equal(refreshDue(reading(5 * 60 * 1000, false), 3600, 900, NOW), false);
    assert.equal(refreshDue(reading(15 * 60 * 1000, false), 3600, 900, NOW), true);
  });
  it('is due when there is no reading', () => assert.equal(refreshDue(null, 3600, 900, NOW), true));
});
