import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextUnfoldState } from '../shared/unfold';

test('a section opens at the viewport midpoint, including when a fast scroll skips it', () => {
  assert.equal(nextUnfoldState('before', 451, 900), 'before');
  assert.equal(nextUnfoldState('before', 450, 900), 'open');
  assert.equal(nextUnfoldState('before', -500, 900), 'open');
});

test('a revealed section stays open above and below the viewport', () => {
  for (const top of [-2000, 0, 450, 1400]) {
    assert.equal(nextUnfoldState('open', top, 900), 'open');
  }
});
