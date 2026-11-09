import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { candidateVersions, fetchCandidate, scoreDeathsPer30d, summarise } from './ucdp_ged';

const res = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('candidateVersions', () => {
  it('steps back month by month across the year boundary', () => {
    assert.deepEqual(candidateVersions(new Date('2026-01-15T00:00:00Z'), 3), ['26.0.1', '25.0.12', '25.0.11']);
    assert.equal(candidateVersions(new Date('2026-11-09T00:00:00Z'))[0], '26.0.11');
  });
});

describe('summarise and score', () => {
  const ev = (d: string, best: number) => ({ date_end: d, best });
  it('normalises deaths to 30 days over the span of the data', () => {
    const events = [ev('2026-07-01', 3000), ev('2026-08-01', 3000), ev('2026-09-01', 3000)]; // 62 days, 9000 deaths
    const s = summarise(events, new Date('2026-11-09T00:00:00Z'));
    assert.equal(s.deaths, 9000);
    assert.ok(Math.abs(s.deathsPer30d - (9000 / 62) * 30) < 1);
    assert.equal(s.newest, '2026-09-01');
  });
  it('ignores events older than 90 days before the newest', () => {
    const s = summarise([ev('2026-01-01', 99999), ev('2026-09-01', 100)], new Date('2026-11-09T00:00:00Z'));
    assert.equal(s.deaths, 100);
  });
  it('maps death rates to scores', () => {
    assert.ok(scoreDeathsPer30d(2000) <= 10);
    assert.ok(scoreDeathsPer30d(12000) > 50 && scoreDeathsPer30d(12000) < 60);
    assert.equal(scoreDeathsPer30d(80000), 100);
  });
});

describe('fetchCandidate', () => {
  const now = new Date('2026-11-09T00:00:00Z');
  it('falls back to the previous monthly release when the newest does not exist', async () => {
    const urls: string[] = [];
    const doFetch = (async (u: string) => {
      urls.push(u);
      return u.includes('/26.0.11') ? res(404) : res(200, { Result: [{ date_end: '2026-09-01', best: 5 }], NextPageUrl: '' });
    }) as unknown as typeof fetch;
    const out = await fetchCandidate('tok', now, doFetch);
    assert.equal(out.version, '26.0.10');
    assert.equal(out.events.length, 1);
    assert.ok(urls[0].includes('/26.0.11'));
  });
  it('follows NextPageUrl', async () => {
    let n = 0;
    const doFetch = (async () => {
      n++;
      return n === 1 ? res(200, { Result: [{ date_end: '2026-09-01', best: 1 }], NextPageUrl: 'https://ucdpapi.pcr.uu.se/next' }) : res(200, { Result: [{ date_end: '2026-09-02', best: 2 }], NextPageUrl: '' });
    }) as unknown as typeof fetch;
    assert.equal((await fetchCandidate('tok', now, doFetch)).events.length, 2);
  });
  it('fails loudly on a refused token, without echoing anything else', async () => {
    await assert.rejects(fetchCandidate('bad', now, (async () => res(401)) as unknown as typeof fetch), /token refused \(HTTP 401\)/);
  });
});
