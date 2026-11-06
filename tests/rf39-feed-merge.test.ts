import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRf39Feed, rf39FeedBaseline, rf39ManualBaseline } from '../shared/rf39-feed-merge';

test('first XML baseline preserves existing fields, later changes update only values still equal to the previous source', () => {
  const current = { title: 'Ручное название', price: 8, description: 'Ручное описание', area: 50, type: 'apartment', elite: false,
    slug: 'manual-slug', featured: true, complexId: 'manual-complex', published: false, sourceId: 'rf39:1' };
  const incoming = { title: 'Название CRM', price: 10, description: 'Описание CRM', area: 50, type: 'apartment', elite: true,
    slug: 'rf39-1', featured: false, complexId: null, published: true, sourceId: 'rf39:1' };
  const first = mergeRf39Feed(current, incoming, null);
  assert.deepEqual(first.changes, {});
  assert.equal(first.baseline.values.price, 10);
  assert.equal(first.baseline.values.slug, undefined);
  assert.equal(first.baseline.values.type, undefined);
  const updated = mergeRf39Feed(current, { ...incoming, price: 12, area: 60 }, first.baseline);
  assert.deepEqual(updated.changes, { area: 60 });
  assert.deepEqual(mergeRf39Feed({ ...current, price: 10 }, { ...incoming, price: 12 }, first.baseline).changes, {});
});

test('manual coordinates stay paired, nulls and arrays compare by value, absent source fields never clear existing data', () => {
  const before = { latitude: 54, longitude: 20, utilities: ['Газ'], price: 10, developer: 'Компания' };
  const incoming = { latitude: 55, longitude: 21, utilities: [], price: null };
  const merged = mergeRf39Feed({ ...before, longitude: 20.5 }, incoming, before);
  assert.deepEqual(merged.changes, { price: null, utilities: [] });
  assert.equal(merged.baseline.values.developer, 'Компания');
  assert.deepEqual(mergeRf39Feed(before, incoming, before).changes, { latitude: 55, longitude: 21, price: null, utilities: [] });
  assert.deepEqual(rf39FeedBaseline({ sourceFetchedAt: new Date(), images: [], published: false, title: 'Название' }), { values: { title: 'Название' }, manualFields: [] });
});

test('manual overrides stay protected after later feeds coincide with the edited value', () => {
  const original = { price: 1000, priceKind: 'total', priceSourceUrl: 'https://rf39.ru', priceArea: null, title: 'CRM', area: 50 };
  const manual = { ...original, price: 800, title: 'Ручное название' };
  const matching = mergeRf39Feed(manual, { ...original, price: 800, title: manual.title, area: 60 }, rf39FeedBaseline(original));
  assert.deepEqual(matching.changes, { area: 60 });
  const next = mergeRf39Feed({ ...manual, ...matching.changes }, { ...original, price: 900, priceKind: null, priceSourceUrl: null, area: 70 }, matching.baseline);
  assert.deepEqual(next.changes, { area: 70 });
  assert.ok(next.baseline.manualFields.includes('priceSourceUrl'));
  const adopted = mergeRf39Feed(manual, original, null);
  const coincided = mergeRf39Feed(manual, { ...original, price: 800, title: manual.title }, adopted.baseline);
  assert.deepEqual(mergeRf39Feed(manual, { ...original, price: 900 }, coincided.baseline).changes, {});
});

test('a missing source field does not erase the baseline or unlock its manual override', () => {
  const original = { title: 'CRM', developer: 'Застройщик' };
  const manual = { ...original, developer: 'Ручной застройщик' };
  const missing = mergeRf39Feed(manual, { title: 'CRM' }, rf39FeedBaseline(original));
  assert.deepEqual(missing.changes, {});
  assert.deepEqual(mergeRf39Feed(manual, { ...original, developer: 'Новый застройщик' }, missing.baseline).changes, {});
});

test('explicit editor changes are preserved even before the first XML sync and when they match the source', () => {
  const baseline = rf39ManualBaseline(null, ['price', 'slug', 'latitude']);
  const current = { price: 800, latitude: 54, longitude: 20 };
  const first = mergeRf39Feed(current, current, baseline);
  assert.deepEqual(first.changes, {});
  assert.deepEqual(mergeRf39Feed(current, { price: 900, latitude: 55, longitude: 21 }, first.baseline).changes, {});
  assert.equal(first.baseline.manualFields.includes('slug'), false);
});

test('manual available floors remain protected separately from building height', () => {
  const original = { availableFloors: [2, 4], floors: 9 };
  const current = { availableFloors: [3, 6], floors: 9 };
  const baseline = rf39ManualBaseline(rf39FeedBaseline(original), ['availableFloors']);
  const next = mergeRf39Feed(current, { availableFloors: [5, 7], floors: 10 }, baseline);
  assert.deepEqual(next.changes, { floors: 10 });
  assert.ok(next.baseline.manualFields.includes('availableFloors'));
});
