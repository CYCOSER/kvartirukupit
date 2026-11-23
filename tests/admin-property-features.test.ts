import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, createRouter, toWebHandler } from 'h3';
import { db } from '../server/utils/db';
import list from '../server/api/admin/property-features/index.get';
import create from '../server/api/admin/property-features/index.post';
import rename from '../server/api/admin/property-features/[id].put';
import remove from '../server/api/admin/property-features/[id].delete';

const router = createRouter().get('/features', list).post('/features', create)
  .put('/features/:id', rename).delete('/features/:id', remove);
const handle = toWebHandler(createApp().use(router));
const request = (path: string, method = 'GET', body?: unknown) => handle(new Request(`http://localhost${path}`, {
  method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
}));

test('dictionary lists, adds and renames shared definitions', async t => {
  const feature = { id: 'terrace', name: 'Терраса', group: 'other' };
  const original = { findMany: db.propertyFeature.findMany, create: db.propertyFeature.create, update: db.propertyFeature.update };
  t.after(() => Object.assign(db.propertyFeature, original));
  const createCall = t.mock.fn(async ({ data }: any) => ({ id: feature.id, ...data }));
  const updateCall = t.mock.fn(async ({ data }: any) => ({ ...feature, ...data }));
  Object.assign(db.propertyFeature, { findMany: async () => [feature], create: createCall, update: updateCall });
  assert.deepEqual(await (await request('/features')).json(), [feature]);
  const created = await request('/features', 'POST', { name: ' Терраса ', group: 'other' });
  assert.equal(created.status, 200);
  assert.deepEqual(createCall.mock.calls[0]!.arguments[0], { data: { name: 'Терраса', group: 'other' } });
  const renamed = await request('/features/terrace', 'PUT', { name: 'Открытая терраса' });
  assert.equal(renamed.status, 200);
  assert.deepEqual(updateCall.mock.calls[0]!.arguments[0], { where: { id: 'terrace' }, data: { name: 'Открытая терраса' } });
});

test('dictionary rejects invalid groups, changing a group, duplicates and missing definitions', async t => {
  const original = { create: db.propertyFeature.create, update: db.propertyFeature.update };
  t.after(() => Object.assign(db.propertyFeature, original));
  Object.assign(db.propertyFeature, {
    create: async () => { throw { code: 'P2002' }; },
    update: async () => { throw { code: 'P2025' }; },
  });
  assert.equal((await request('/features', 'POST', { name: 'Терраса', group: 'unknown' })).status, 400);
  assert.equal((await request('/features', 'POST', { name: ' ', group: 'other' })).status, 400);
  assert.equal((await request('/features', 'POST', { name: 'Терраса', group: 'other' })).status, 409);
  assert.equal((await request('/features/terrace', 'PUT', { name: 'Терраса', group: 'location' })).status, 400);
  assert.equal((await request('/features/missing', 'PUT', { name: 'Терраса' })).status, 404);
});

test('dictionary deletion locks property saves and never clears explicit group overrides', async t => {
  const lock = t.mock.fn(async () => 1);
  const deleted = t.mock.fn(async ({ where }: any) => ({ count: where.id === 'terrace' ? 1 : 0 }));
  const transaction = db.$transaction;
  t.after(() => { db.$transaction = transaction; });
  db.$transaction = (async (run: any) => run({ $executeRaw: lock, propertyFeature: { deleteMany: deleted } })) as typeof db.$transaction;
  assert.equal((await request('/features/terrace', 'DELETE')).status, 200);
  assert.equal(lock.mock.callCount(), 1);
  assert.deepEqual(deleted.mock.calls[0]!.arguments[0], { where: { id: 'terrace' } });
  assert.equal((await request('/features/missing', 'DELETE')).status, 404);
});
