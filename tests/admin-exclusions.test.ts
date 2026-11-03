import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyAdminExclusions, matchesAdminExclusions } from '../shared/admin-exclusions';

test('exclusion phrases are case insensitive, retain commas and spaces, and ignore empty entries', () => {
  const filters = { ...emptyAdminExclusions(), text: '  У МОРЯ ; \r\nМира, 1\n ; ' };
  assert.equal(matchesAdminExclusions(filters, 'Квартира у моря', {}), false);
  assert.equal(matchesAdminExclusions(filters, 'Улица Мира, 12', {}), false);
  assert.equal(matchesAdminExclusions(filters, 'Улица Мира, 2', {}), true);
  assert.equal(matchesAdminExclusions({ ...filters, text: ' ; \r\n' }, '', {}), true);
});

test('any excluded exact value hides the row; missing values survive unless explicitly mapped', () => {
  const filters = { text: '', values: { city: ['Калининград', 'Зеленоградск'], status: ['sold'], rooms: ['unknown'] } };
  assert.equal(matchesAdminExclusions(filters, '', { city: 'Калининград', status: 'available' }), false);
  assert.equal(matchesAdminExclusions(filters, '', { city: 'Зеленоградск' }), false);
  assert.equal(matchesAdminExclusions(filters, '', { city: 'Пионерский', status: 'sold' }), false);
  assert.equal(matchesAdminExclusions(filters, '', { city: 'Пионерский', rooms: null }), true);
  assert.equal(matchesAdminExclusions(filters, '', { rooms: 'unknown' }), false);
  assert.equal(matchesAdminExclusions(filters, '', { city: 'Калининградская область' }), true);
  assert.equal(matchesAdminExclusions(emptyAdminExclusions(), 'Калининград', { status: 'sold' }), true);
});
