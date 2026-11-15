import assert from 'node:assert/strict';
import { test } from 'node:test';
import { propertyFeatures } from '../shared/property-features';

const complex = { id: 'complex', title: 'ЖК', slug: 'complex', published: true, heatingType: 'Газовое автономное', fencedTerritory: true, locationTags: ['У моря' as const] };

test('newbuild apartments inherit known complex features', () => {
  assert.deepEqual(propertyFeatures({ complex }), { heatingType: complex.heatingType, fencedTerritory: true, locationTags: ['У моря'] });
  assert.deepEqual(propertyFeatures({ heatingType: null, fencedTerritory: null, locationTags: [], complex }), { heatingType: complex.heatingType, fencedTerritory: true, locationTags: ['У моря'] });
});

test('own heating and an explicit unfenced territory override complex features', () => {
  assert.deepEqual(propertyFeatures({ heatingType: ' Центральное ', fencedTerritory: false, locationTags: ['У парка'], complex }), { heatingType: 'Центральное', fencedTerritory: false, locationTags: ['У парка'] });
});

test('unknown features and secondary apartments do not claim amenities', () => {
  assert.deepEqual(propertyFeatures({}), { heatingType: null, fencedTerritory: null, locationTags: [] });
  assert.deepEqual(propertyFeatures({ housingMarket: 'secondary', complex }), { heatingType: null, fencedTerritory: null, locationTags: [] });
});
