import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, createRouter, toWebHandler } from 'h3';
import { db } from '../server/utils/db';
import list from '../server/api/agent/v1/properties/index.get';
import get from '../server/api/agent/v1/properties/[id].get';
import patch from '../server/api/agent/v1/properties/[id]/description.patch';
import clear from '../server/api/agent/v1/properties/[id]/description.delete';
import { agentPropertySelect } from '../server/utils/agent-properties';

const router = createRouter()
  .get('/properties', list)
  .get('/properties/:id', get)
  .patch('/properties/:id/description', patch)
  .delete('/properties/:id/description', clear);
const handle = toWebHandler(createApp().use(router));
const request = (path: string, method = 'GET', body?: unknown) => handle(new Request(`http://localhost${path}`, {
  method,
  ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
}));

function mockProperty(t: TestContext, current: Record<string, unknown> | null = {
  id: 'one', description: 'Старое описание', sourceId: null,
}) {
  const original = {
    findMany: db.property.findMany, count: db.property.count,
    findUnique: db.property.findUnique, update: db.property.update,
    transaction: db.$transaction,
  };
  const findMany = t.mock.fn(async (..._args: any[]) => [{ id: 'one', title: 'Квартира' }]);
  const count = t.mock.fn(async (..._args: any[]) => 1);
  const findUnique = t.mock.fn(async (..._args: any[]) => current);
  const update = t.mock.fn(async (args: any) => ({ id: 'one', description: args.data.description }));
  const lock = t.mock.fn(async (..._args: any[]) => 1);
  const transaction = t.mock.fn(async (callback: any) => callback({
    $executeRaw: lock, property: { findUnique, update },
  }));
  Object.assign(db.property, { findMany, count, findUnique, update });
  db.$transaction = transaction as any;
  t.after(() => {
    Object.assign(db.property, { findMany: original.findMany, count: original.count, findUnique: original.findUnique, update: original.update });
    db.$transaction = original.transaction;
  });
  return { findMany, count, findUnique, update, transaction, lock };
}

test('agent property listing paginates and filters unpublished objects without exposing internal fields', async (t) => {
  const mock = mockProperty(t);
  const response = await request('/properties?limit=5&offset=10&q=Море&type=apartment&published=false&slug=one');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [{ id: 'one', title: 'Квартира' }], total: 1, limit: 5, offset: 10 });
  const query = mock.findMany.mock.calls[0]!.arguments[0];
  assert.equal(query.take, 5);
  assert.equal(query.skip, 10);
  assert.deepEqual(query.orderBy, { id: 'asc' });
  assert.equal(query.where.published, false);
  assert.equal(query.where.type, 'apartment');
  assert.equal(query.where.slug, 'one');
  assert.equal(query.where.OR[0].title.contains, 'Море');
  assert.deepEqual(mock.count.mock.calls[0]!.arguments[0], { where: query.where });
  for (const key of ['leads', 'sourceId', 'rf39Baseline', 'sourceUrl', 'description']) assert.equal(key in query.select, false);

  assert.equal((await request('/properties')).status, 200);
  assert.equal(mock.findMany.mock.calls[1]!.arguments[0].take, 20);
  assert.equal(mock.findMany.mock.calls[1]!.arguments[0].skip, 0);
});

test('invalid agent property filters never reach the database', async (t) => {
  const mock = mockProperty(t);
  for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'limit=1&limit=2', 'offset=-1', 'offset=2147483648', 'published=1', 'type=house', 'slug=bad/slug', 'unknown=yes', `q=${'x'.repeat(201)}`]) {
    assert.equal((await request(`/properties?${query}`)).status, 400, query);
  }
  assert.equal(mock.findMany.mock.callCount(), 0);
  assert.equal(mock.count.mock.callCount(), 0);
});

test('agent property detail selects only public content fields', async (t) => {
  const mock = mockProperty(t);
  assert.equal((await request('/properties/one')).status, 200);
  assert.deepEqual(mock.findUnique.mock.calls[0]!.arguments[0], { where: { id: 'one' }, select: agentPropertySelect });
  for (const key of ['leads', 'sourceId', 'rf39Baseline', 'sourceUrl', 'sourceNote']) assert.equal(key in agentPropertySelect, false);
});

test('agent description edits and clearing change only description within the existing transaction lock', async (t) => {
  const mock = mockProperty(t);
  const response = await request('/properties/one/description', 'PATCH', { description: '  Новое описание  ' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: 'one', description: 'Новое описание' });
  assert.deepEqual(mock.update.mock.calls[0]!.arguments[0], {
    where: { id: 'one' }, data: { description: 'Новое описание' }, select: agentPropertySelect,
  });
  assert.equal(mock.lock.mock.callCount(), 1);
  assert.equal((await request('/properties/one/description', 'DELETE')).status, 200);
  assert.deepEqual(mock.update.mock.calls[1]!.arguments[0].data, { description: '' });
  assert.equal((await request('/properties/one/description', 'PATCH', { description: '' })).status, 200);
  assert.deepEqual(mock.update.mock.calls[2]!.arguments[0].data, { description: '' });
});

test('agent RF39 description clearing retains previous manual overrides and marks description as manual', async (t) => {
  const mock = mockProperty(t, {
    id: 'one', description: 'Описание CRM', sourceId: 'rf39:123',
    rf39Baseline: { values: { description: 'Описание CRM', price: 100 }, manualFields: ['title'] },
  });
  assert.equal((await request('/properties/one/description', 'DELETE')).status, 200);
  assert.deepEqual(mock.update.mock.calls[0]!.arguments[0].data, {
    description: '',
    rf39Baseline: { values: { description: 'Описание CRM', price: 100 }, manualFields: ['title', 'description'] },
  });
});

test('agent description payload rejects missing, excessive and unrelated fields before writing', async (t) => {
  const mock = mockProperty(t);
  for (const body of [{}, null, [], { description: null }, { description: 12 }, { description: 'x'.repeat(30001) }, { description: 'Текст', price: 1 }, { description: 'Текст', published: true }]) {
    assert.equal((await request('/properties/one/description', 'PATCH', body)).status, 400);
  }
  assert.equal(mock.transaction.mock.callCount(), 0);
  assert.equal(mock.update.mock.callCount(), 0);
});

test('missing agent properties return 404 without writing', async (t) => {
  const mock = mockProperty(t, null);
  assert.equal((await request('/properties/missing')).status, 404);
  assert.equal((await request('/properties/missing/description', 'PATCH', { description: 'Новое описание' })).status, 404);
  assert.equal((await request('/properties/missing/description', 'DELETE')).status, 404);
  assert.equal(mock.update.mock.callCount(), 0);
});
