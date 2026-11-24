import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Tag } from '../shared/tag';
import { db } from '../server/utils/db';
import { runTagTask } from '../server/utils/run-tag-task';

const ordinary: Tag = { id: 'ordinary', name: 'У моря', propertyFeature: null };
const heating: Tag = { id: 'heating', name: 'Газовое', propertyFeature: { id: 'gas', name: 'Газовое', group: 'heating' } };

function fixture(t: TestContext, tag: Tag, properties: Record<string, any>[] = [], articles: Record<string, any>[] = []) {
  const original = {
    tag: db.tag.findUnique,
    properties: db.property.findMany,
    articles: db.article.findMany,
    transaction: db.$transaction,
  };
  const findTag = t.mock.fn(async (..._args: any[]) => tag);
  const findProperties = t.mock.fn(async (..._args: any[]) => properties);
  const findArticles = t.mock.fn(async (..._args: any[]) => articles);
  const lock = t.mock.fn(async (..._args: any[]) => 1);
  const batchProperties = t.mock.fn(async ({ where }: any) => properties.filter(item => where.id.in.includes(item.id)));
  const update = t.mock.fn(async ({ where, data }: any) => ({ id: where.id, ...data }));
  const create = t.mock.fn(async ({ data }: any) => ({ count: data.length }));
  const remove = t.mock.fn(async (..._args: any[]) => ({ count: 0 }));
  const tx = {
    $executeRaw: lock,
    tag: {
      findUnique: findTag,
      findMany: async ({ where }: any) => tag.propertyFeature && where.propertyFeatureId.in.includes(tag.propertyFeature.id) ? [{ id: tag.id }] : [],
    },
    property: { findMany: batchProperties, update },
    tagRelation: { createMany: create, deleteMany: remove },
  };
  const transaction = t.mock.fn(async (run: (client: any) => unknown, _options?: { timeout?: number }) => run(tx));
  db.tag.findUnique = findTag as any;
  db.property.findMany = findProperties as any;
  db.article.findMany = findArticles as any;
  db.$transaction = transaction as any;
  t.after(() => {
    db.tag.findUnique = original.tag;
    db.property.findMany = original.properties;
    db.article.findMany = original.articles;
    db.$transaction = original.transaction;
  });
  return { findTag, findProperties, findArticles, lock, batchProperties, update, create, remove, transaction };
}

test('a property badge task cannot target articles and rejects before fetching candidates', async t => {
  const f = fixture(t, heating, [], [{ id: 'article', title: 'Газовое отопление' }]);
  await assert.rejects(runTagTask({ type: 'article', tagId: heating.id, params: [{ param: 'title', value_contain: 'Газовое' }] }), { statusCode: 400 });
  assert.equal(f.findArticles.mock.callCount(), 0);
  assert.equal(f.findProperties.mock.callCount(), 0);
  assert.equal(f.transaction.mock.callCount(), 0);
  assert.equal(f.create.mock.callCount(), 0);
});

test('ordinary property tasks require all case-insensitive conditions and retain assignment counts', async t => {
  const f = fixture(t, ordinary, [
    { id: 'one', location: 'Калининград', finish: 'Чистовая' },
    { id: 'two', location: 'КАЛИНИНГРАД, центр', finish: 'чистовая отделка' },
    { id: 'other-city', location: 'Зеленоградск', finish: 'Чистовая' },
    { id: 'other-finish', location: 'Калининград', finish: 'Серый ключ' },
  ]);
  const summary = await runTagTask({ type: 'apartment', tagId: ordinary.id, params: [
    { param: 'location', value_contain: 'калининград' },
    { param: 'finish', value_contain: 'ЧИСТО' },
  ] });
  assert.deepEqual(summary, {
    matchedCount: 2, assignedCount: 2, propertyRelationsCreated: 2, articleRelationsCreated: 0,
    badgesAssigned: 0, skippedCount: 0, skipped: { secondary: 0, heatingConflict: 0, clearedGroup: 0, limit: 0 },
  });
  assert.deepEqual(f.findProperties.mock.calls[0]!.arguments[0].where, { type: 'apartment' });
  assert.deepEqual(f.create.mock.calls[0]!.arguments[0], {
    data: [{ tagId: ordinary.id, propertyId: 'one' }, { tagId: ordinary.id, propertyId: 'two' }], skipDuplicates: true,
  });
  assert.equal(f.lock.mock.callCount(), 1);
  assert.equal(f.findArticles.mock.callCount(), 0);
  assert.equal(f.update.mock.callCount(), 0);
  assert.equal(f.remove.mock.callCount(), 0);
});

test('ordinary article tasks keep article-only assignment and count behavior', async t => {
  const f = fixture(t, ordinary, [], [
    { id: 'match', title: 'Жизнь у моря', content: 'Побережье' },
    { id: 'other', title: 'Жизнь в центре', content: 'Город' },
  ]);
  const summary = await runTagTask({ type: 'article', tagId: ordinary.id, params: [{ param: 'title', value_contain: 'МОРЯ' }] });
  assert.equal(summary.matchedCount, 1);
  assert.equal(summary.assignedCount, 1);
  assert.equal(summary.articleRelationsCreated, 1);
  assert.equal(summary.propertyRelationsCreated, 0);
  assert.equal(summary.badgesAssigned, 0);
  assert.equal(summary.skippedCount, 0);
  assert.deepEqual(f.create.mock.calls[0]!.arguments[0].data, [{ tagId: ordinary.id, articleId: 'match' }]);
  assert.equal(f.findProperties.mock.callCount(), 0);
  assert.equal(f.update.mock.callCount(), 0);
});

test('ordinary tag rules retain 500-item batches for large selections', async t => {
  const properties = Array.from({ length: 501 }, (_, index) => ({ id: `property-${index}`, location: 'Калининград' }));
  const f = fixture(t, ordinary, properties);
  const summary = await runTagTask({ type: 'apartment', tagId: ordinary.id, params: [{ param: 'location', value_contain: 'Калининград' }] });
  assert.equal(summary.matchedCount, 501);
  assert.equal(summary.assignedCount, 501);
  assert.equal(summary.propertyRelationsCreated, 501);
  assert.equal(summary.badgesAssigned, 0);
  assert.equal(summary.skippedCount, 0);
  assert.equal(f.transaction.mock.callCount(), 2);
  assert.equal(f.lock.mock.callCount(), 2);
  assert.deepEqual(f.create.mock.calls.map(call => call.arguments[0].data.length), [500, 1]);
  assert.deepEqual(f.transaction.mock.calls.map(call => call.arguments[1]), [{ timeout: 30_000 }, { timeout: 30_000 }]);
  assert.equal(f.update.mock.callCount(), 0);
});

test('badge rules use 50-item transactions and aggregate assignments and each protected skip reason', async t => {
  const properties = Array.from({ length: 501 }, (_, index) => ({
    id: `property-${index}`, type: 'apartment', location: 'Калининград',
    housingMarket: index === 0 ? 'secondary' : 'newbuild',
    features: index === 1 ? [{ id: 'central', name: 'Центральное', group: 'heating' }]
      : index === 3 ? Array.from({ length: 200 }, (_, number) => ({ id: `existing-${number}`, name: `Значок ${number}`, group: 'other' })) : [],
    featureOverrides: index === 1 || index === 2 ? ['heating'] : index === 3 ? ['other'] : [],
    complex: null,
  }));
  const f = fixture(t, heating, properties);
  const summary = await runTagTask({ type: 'apartment', tagId: heating.id, params: [{ param: 'location', value_contain: 'Калининград' }] });
  assert.deepEqual(summary, {
    matchedCount: 501, assignedCount: 497, propertyRelationsCreated: 497, articleRelationsCreated: 0,
    badgesAssigned: 497, skippedCount: 4, skipped: { secondary: 1, heatingConflict: 1, clearedGroup: 1, limit: 1 },
  });
  assert.equal(f.transaction.mock.callCount(), 11);
  assert.equal(f.lock.mock.callCount(), 11);
  assert.equal(f.findTag.mock.callCount(), 12);
  assert.deepEqual(f.batchProperties.mock.calls.map(call => call.arguments[0].where.id.in.length), [...Array(10).fill(50), 1]);
  assert.ok(f.transaction.mock.calls.every(call => call.arguments[1]?.timeout === 30_000));
  assert.equal(f.update.mock.callCount(), 497);
  assert.deepEqual(f.update.mock.calls.at(-1)!.arguments[0].where, { id: 'property-500' });
  assert.equal(f.findArticles.mock.callCount(), 0);
});
