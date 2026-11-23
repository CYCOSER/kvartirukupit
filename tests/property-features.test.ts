import test from 'node:test';
import assert from 'node:assert/strict';
import { propertyFeatures } from '../shared/property-features';
import type { PropertyFeature } from '../shared/property-feature';

const heating: PropertyFeature = { id: 'gas', name: 'Газовое автономное', group: 'heating' };
const fence: PropertyFeature = { id: 'fence', name: 'Огороженная территория', group: 'territory' };
const sea: PropertyFeature = { id: 'sea', name: 'У моря', group: 'location' };
const park: PropertyFeature = { id: 'park', name: 'У парка', group: 'location' };
const pool: PropertyFeature = { id: 'pool', name: 'Бассейн', group: 'other' };
const complex = { id: 'complex', title: 'ЖК', slug: 'complex', published: true, features: [sea, fence, heating, pool], featureOverrides: [] };

test('complex benefits are ordered by group and inherited by apartments', () => {
  assert.deepEqual(propertyFeatures(complex), [heating, fence, sea, pool]);
  assert.deepEqual(propertyFeatures({ complex }), [heating, fence, sea, pool]);
});

test('local groups replace inherited groups while untouched groups still inherit', () => {
  assert.deepEqual(propertyFeatures({ complex, features: [park], featureOverrides: ['location'] }), [heating, fence, park, pool]);
});

test('empty local group explicitly hides inherited benefits', () => {
  assert.deepEqual(propertyFeatures({ complex, features: [], featureOverrides: ['heating', 'territory', 'location', 'other'] }), []);
});

test('returning a group to inheritance ignores its stale local selection', () => {
  assert.deepEqual(propertyFeatures({ complex, features: [park], featureOverrides: [] }), [heating, fence, sea, pool]);
});

test('unlinked objects display their selected benefits and secondary apartments hide them', () => {
  assert.deepEqual(propertyFeatures({ features: [park, pool] }), [park, pool]);
  assert.deepEqual(propertyFeatures({}), []);
  assert.deepEqual(propertyFeatures({ housingMarket: 'secondary', features: [park], complex }), []);
});
