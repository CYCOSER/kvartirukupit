import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextUnfoldState } from '../shared/unfold';

test('the seam opens and closes at the middle only in the matching scroll direction', () => {
  assert.equal(nextUnfoldState('before', 451, 451, 900, 1), 'before');
  assert.equal(nextUnfoldState('before', 450, 450, 900, 1), 'open');
  assert.equal(nextUnfoldState('open', -500, 451, 900, 1), 'open');
  assert.equal(nextUnfoldState('open', -500, 450, 900, 1), 'after');
  assert.equal(nextUnfoldState('after', 450, 450, 900, 1), 'after');
  assert.equal(nextUnfoldState('after', 449, 449, 900, -1), 'after');
  assert.equal(nextUnfoldState('after', 450, 450, 900, -1), 'open');
  assert.equal(nextUnfoldState('open', 449, 1400, 900, -1), 'open');
  assert.equal(nextUnfoldState('open', 450, 1400, 900, -1), 'before');
  assert.equal(nextUnfoldState('before', 450, 450, 900, -1), 'before');
  assert.equal(nextUnfoldState('after', 450, 450, 900, 0), 'after');
  assert.equal(nextUnfoldState('before', 450, 450, 900, 0), 'before');
});
