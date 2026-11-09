import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chokepointScore } from './portwatch';
import { parseBasket, riskProbability, scoreProbability, DEFAULT_BASKET } from './polymarket';

describe('chokepointScore', () => {
  const flat = Array.from({ length: 200 }, () => 100);
  it('normal traffic is low stress', () => assert.ok(chokepointScore(flat).score < 15));
  it('a sudden 60 % drop is maximal stress', () => {
    const d = [...Array.from({ length: 7 }, () => 40), ...Array.from({ length: 193 }, () => 100)];
    assert.ok(chokepointScore(d).score >= 95);
  });
  it('a long-standing low level still shows, but less than a fresh collapse', () => {
    const low = Array.from({ length: 200 }, (_, i) => (i < 100 ? 50 : 100));
    const r = chokepointScore(low);
    assert.ok(r.score > 15 && r.score < 95, String(r.score));
  });
});

describe('polymarket', () => {
  it('reads YES and NO risk from outcomePrices', () => {
    const m = { slug: 'x', question: 'q', outcomePrices: '["0.115","0.885"]' };
    assert.equal(riskProbability(m, 'yes'), 0.115);
    assert.ok(Math.abs(riskProbability(m, 'no') - 0.885) < 1e-9);
  });
  it('scores sensible levels', () => {
    assert.ok(scoreProbability(0.02, 'yes') < 10);
    assert.ok(scoreProbability(0.4, 'no') > 60);
  });
  it('parses the basket override and rejects junk', () => {
    assert.deepEqual(parseBasket('a:yes:3,b:no'), [{ slug: 'a', risk: 'yes', weight: 3 }, { slug: 'b', risk: 'no', weight: 1 }]);
    assert.throws(() => parseBasket('a:maybe'), /bad WW3_POLYMARKET_BASKET/);
    assert.equal(parseBasket(undefined), DEFAULT_BASKET);
  });
});
