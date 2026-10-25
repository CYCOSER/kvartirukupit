import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loopScroll } from '../shared/carousel';

test('loop boundaries keep the same visual position in the middle copy', () => {
  assert.equal(loopScroll(5000, 2500), 2500);
  assert.equal(loopScroll(2000, 2500), 4500);
  assert.equal(loopScroll(3000, 2500), 3000);
  assert.equal(loopScroll(0, 0), 0);
});
