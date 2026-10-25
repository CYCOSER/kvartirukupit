import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateMortgage } from '../shared/mortgage';
test('annuity calculation and edge cases', () => {
  const result = calculateMortgage(1250000, 20, 1, 12)!;
  assert.ok(Math.abs(result.monthly - 88848.79) < .01);
  assert.equal(result.principal, 1000000);
  assert.equal(calculateMortgage(1200000, 0, 10, 0)!.monthly, 10000);
  assert.equal(calculateMortgage(1200000, 100, 20, 16.9)!.monthly, 0);
  assert.equal(calculateMortgage(0, 20, 20, 16.9), null);
  assert.equal(calculateMortgage(1200000, 101, 20, 16.9), null);
  assert.equal(calculateMortgage(1200000, 20, 0, 16.9), null);
  assert.equal(calculateMortgage(1200000, 20, 2.5, 16.9), null);
  assert.equal(calculateMortgage(1200000, 20, 20, NaN), null);
});
