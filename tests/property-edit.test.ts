import test from 'node:test';
import assert from 'node:assert/strict';
import { propertySchema } from '../shared/property';
import { changedPropertyFields, mergePropertyUpdate, parsePropertyUpdate, propertyEditFields } from '../shared/property-edit';

const initial = propertySchema.parse({
  title: 'Квартира у моря', slug: 'apartment', type: 'apartment', housingMarket: null, complexId: null,
  nmarketComplexId: null, rf39ComplexId: null, rf39BuildingId: null,
  location: 'Калининград', address: 'Мира, 1', latitude: null, longitude: null,
  price: 5000000, status: 'available', area: 50, landArea: null, bedrooms: 2, floors: 5, availableFloors: [],
  readiness: 'Готов', finish: 'Чистовая', seaDistance: null, description: 'Исходное описание', utilities: [],
  published: false, featured: false, elite: false, demo: false,
});

test('editor saves only dirty fields and retains concurrent price, publication and catalog updates', () => {
  const edited = { ...initial, description: 'Ручное описание', utilities: ['Терраса'] };
  const changedFields = changedPropertyFields(initial, edited);
  assert.deepEqual(changedFields, ['description', 'utilities']);
  const current = { ...initial, price: 6200000, published: true, elite: true, rf39BuildingId: 'new-building', availableFloors: [2, 5] };
  const merged = mergePropertyUpdate(current, parsePropertyUpdate({ ...edited, changedFields }));
  assert.deepEqual(merged, { ...current, description: edited.description, utilities: edited.utilities });
  assert.deepEqual(mergePropertyUpdate(current, parsePropertyUpdate({ ...initial, changedFields: [] })), current);
});

test('legacy full PUT remains a full update while metadata cannot write protected or missing fields', () => {
  const current = { ...initial, price: 6200000, published: true };
  assert.deepEqual(mergePropertyUpdate(current, parsePropertyUpdate({ ...initial, description: 'Правка старого клиента', sourceId: 'forged' })),
    { ...initial, description: 'Правка старого клиента' });
  for (const changedFields of [['sourceId'], ['updatedAt'], ['__proto__'], [123], 'price', Array(100).fill('price')])
    assert.throws(() => parsePropertyUpdate({ ...initial, changedFields }));
  const { rf39BuildingId: omitted, ...withoutMapping } = initial;
  assert.throws(() => parsePropertyUpdate({ ...withoutMapping, changedFields: ['rf39BuildingId'] }));
  assert.deepEqual([...propertyEditFields].sort(), Object.keys(initial).sort());
});

test('type edits include dependent fields and the final merged property is validated', () => {
  const edited = { ...initial, type: 'complex' as const };
  const changedFields = changedPropertyFields(initial, edited);
  assert.deepEqual(changedFields, ['type', 'elite', 'complexId', 'housingMarket', 'availableFloors']);
  const current = { ...initial, elite: true, complexId: 'complex', housingMarket: 'secondary' as const, availableFloors: [2, 5] };
  const merged = mergePropertyUpdate(current, parsePropertyUpdate({ ...edited, changedFields }));
  assert.equal(merged.type, 'complex');
  assert.equal(merged.elite, false);
  assert.equal(merged.complexId, null);
  assert.equal(merged.housingMarket, null);
  assert.deepEqual(merged.availableFloors, []);
  assert.throws(() => mergePropertyUpdate(current, parsePropertyUpdate({ ...edited, changedFields: ['type'] })));
  assert.throws(() => mergePropertyUpdate(current, parsePropertyUpdate({ ...initial, latitude: 54.7, longitude: 20.4, changedFields: ['longitude'] })));
});

test('available floor edits normalize values and leave total building floors unchanged', () => {
  const edited = propertySchema.parse({ ...initial, availableFloors: [4, 2, 4] });
  assert.deepEqual(changedPropertyFields(initial, edited), ['availableFloors']);
  const merged = mergePropertyUpdate(initial, parsePropertyUpdate({ ...edited, changedFields: ['availableFloors'] }));
  assert.deepEqual(merged.availableFloors, [2, 4]);
  assert.equal(merged.floors, 5);
});
