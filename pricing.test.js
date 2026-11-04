const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCents, validPrice } = require('./pricing');
test('USD text parsing uses exact cents and rejects ambiguous or excessive precision', () => {
  for (const [value, cents] of [['25',2500],['25.01',2501],['0.29',29],['25.1',2510],['999999.99',99999999]]) assert.equal(parseCents(value),cents);
  for (const value of ['', ' ', '-1', '1.001', '1e3', 'Infinity', '1,000', '1000000', '.', null]) assert.equal(parseCents(value),null);
  assert.equal(validPrice(2500,2500),true);
  assert.equal(validPrice(2501,2500),true);
  assert.equal(validPrice(2499,2500),false);
});
