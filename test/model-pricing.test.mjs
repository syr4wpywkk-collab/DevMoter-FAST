import test from 'node:test';
import assert from 'node:assert/strict';
import { describeModelPricing, normalizeModelPricing } from '../src/model-pricing.mjs';

test('missing, malformed and partial zero rates never assert free usage', () => {
  for (const value of [null, undefined, {}, [], { input: '0', output: '0' }, { input: 0 }, { input: -1, output: NaN }]) {
    assert.match(describeModelPricing(value).label, /料金不明/);
    assert.doesNotMatch(describeModelPricing(value).label, /^無料/);
  }
});
test('positive input/output or cache rate is shown as a paid catalogue rate', () => {
  for (const cost of [{ input: 2, output: 8 }, { input: 0, output: 0, cache_write: 1 }]) {
    assert.match(describeModelPricing(cost).label, /有料単価/);
    assert.match(describeModelPricing(cost).detail, /provider/);
  }
});
test('zero base prices remain explicitly distinct from a free account or invoice', () => {
  assert.equal(describeModelPricing({ input: 0, output: 0 }).label, '基本単価0・無料保証なし');
  assert.deepEqual(normalizeModelPricing({ input: 1, output: 2, token: 'private', cache_read: Infinity }), { input: 1, output: 2 });
});
