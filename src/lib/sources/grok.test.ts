import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { callGrok, extractOutputText, GROK_TOPICS, parseGrokTopics, scoreGrokTopics, smoothGrok, topicConfidence, type GrokTopicReading } from './grok_x_social';
import { taiexScore } from './taiex';

const topic = (id: string, intensity: number, accounts = 5, confirmed = false): GrokTopicReading => ({ id, intensity, credibleAccounts: accounts, confirmedOutsideX: confirmed, posts: [] });
const all = (f: (id: string) => GrokTopicReading) => GROK_TOPICS.map((t) => f(t.id));
const jsonFor = (topics: GrokTopicReading[]) =>
  JSON.stringify({ topics: topics.map((t) => ({ id: t.id, intensity: t.intensity, credible_accounts: t.credibleAccounts, confirmed_outside_x: t.confirmedOutsideX, posts: t.posts })) });

describe('parseGrokTopics', () => {
  it('accepts fenced JSON with all topics', () => {
    const text = '```json\n' + jsonFor(all((id) => topic(id, 1))) + '\n```';
    assert.equal(parseGrokTopics(text).length, GROK_TOPICS.length);
  });
  it('rejects missing topics, bad intensity and non-JSON', () => {
    assert.throws(() => parseGrokTopics(jsonFor(all((id) => topic(id, 1)).slice(1))), /missing topics/);
    assert.throws(() => parseGrokTopics(jsonFor(all((id) => topic(id, 9)))), /bad intensity/);
    assert.throws(() => parseGrokTopics('the world is calm'), /no JSON/);
  });
  it('ignores unknown topic ids instead of trusting them', () => {
    const extra = jsonFor([...all((id) => topic(id, 1)), topic('injected', 5)]);
    assert.equal(parseGrokTopics(extra).length, GROK_TOPICS.length);
  });
});

describe('scoreGrokTopics', () => {
  it('confidence: 0 under 3 credible accounts, 0.5 with 3+, 1 when confirmed outside X', () => {
    assert.equal(topicConfidence(topic('x', 4, 2, true)), 0);
    assert.equal(topicConfidence(topic('x', 4, 3)), 0.5);
    assert.equal(topicConfidence(topic('x', 4, 3, true)), 1);
  });
  it('calm X scores low', () => {
    assert.ok(scoreGrokTopics(all((id) => topic(id, 0)), []).score <= 10);
  });
  it('noise without any outside confirmation is capped at 40', () => {
    const r = scoreGrokTopics(all((id) => topic(id, 5, 50, false)), []);
    assert.equal(r.score, 40);
    assert.match(r.capped ?? '', /capped at 40/);
  });
  it('a single confirmed topic cannot push past 69', () => {
    const r = scoreGrokTopics(all((id) => topic(id, 5, 50, id === 'nuclear')), []);
    assert.ok(r.score <= 69);
  });
  it('wide confirmed escalation scores high', () => {
    const r = scoreGrokTopics(all((id) => topic(id, 4, 20, true)), []);
    assert.ok(r.score >= 75, String(r.score));
  });
  it('adds up to +10 for excess over the own 14-day p90', () => {
    const past = Array.from({ length: 20 }, () => 1);
    const r = scoreGrokTopics(all((id) => topic(id, 3, 20, true)), past);
    assert.ok(r.novelty > 0 && r.novelty <= 10);
  });
});

describe('smoothGrok', () => {
  it('limits the move to ±15 per cycle', () => {
    assert.ok(smoothGrok(100, [100, 100], 30) <= 45);
    assert.ok(smoothGrok(0, [0, 0], 80) >= 65);
  });
  it('uses the median so one outlier does not move the score', () => {
    assert.ok(Math.abs(smoothGrok(95, [30, 32], 31) - 31) < 3);
  });
});

describe('callGrok', () => {
  it('refuses to run without a key', async () => {
    delete process.env.XAI_API_KEY;
    await assert.rejects(callGrok((async () => new Response('{}')) as typeof fetch), /XAI_API_KEY not set/);
  });
  it('turns billing errors into a short message without the body', async () => {
    process.env.XAI_API_KEY = 'test-key';
    await assert.rejects(callGrok((async () => new Response('secret-account-details', { status: 402 })) as typeof fetch), (e: Error) => /HTTP 402/.test(e.message) && !/secret/.test(e.message));
    delete process.env.XAI_API_KEY;
  });
  it('reads output_text from the Responses API shape', () => {
    assert.equal(extractOutputText({ output: [{ type: 'tool_call' }, { type: 'message', content: [{ type: 'output_text', text: '{"a":1}' }] }] }), '{"a":1}');
    assert.throws(() => extractOutputText({ output: [] }), /no text/);
  });
});

describe('taiexScore', () => {
  it('flat market near its high is low stress', () => assert.ok(taiexScore(100, 101, 100).score < 30));
  it('a 16% drawdown and −10% month is stressed', () => assert.ok(taiexScore(84, 100, 93).score > 60));
});
