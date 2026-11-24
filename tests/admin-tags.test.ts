import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, createRouter, toWebHandler } from 'h3';
import { db } from '../server/utils/db';
import list from '../server/api/admin/tags/index.get';
import create from '../server/api/admin/tags/index.post';
import rename from '../server/api/admin/tags/[id].put';
import remove from '../server/api/admin/tags/[id].delete';
import createTask from '../server/api/admin/tags-tasks/index.post';
import { tagInclude } from '../server/utils/tag-definitions';

const handle = toWebHandler(createApp().use(createRouter().get('/tags', list).post('/tags', create)
  .put('/tags/:id', rename).delete('/tags/:id', remove).post('/tasks', createTask)));
const request = (path: string, method = 'GET', body?: unknown) => handle(new Request(`http://localhost${path}`, {
  method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
}));
function transaction(t: TestContext, tx: object) {
  const previous = db.$transaction;
  t.after(() => { db.$transaction = previous; });
  db.$transaction = (async (run: any) => run({ $executeRaw: async () => 1, ...tx })) as typeof db.$transaction;
}

test('unified dictionary creates ordinary tags and badge definitions atomically', async t => {
  const calls = t.mock.fn(async (args: any) => ({ id: 'tag', name: args.data.name,
    propertyFeature: args.data.propertyFeature ? { id: 'feature', ...args.data.propertyFeature.create } : null }));
  transaction(t, { tag: { create: calls } });
  assert.deepEqual(await (await request('/tags', 'POST', { name: ' Обычный тег ' })).json(), { id: 'tag', name: 'Обычный тег', propertyFeature: null });
  assert.deepEqual(await (await request('/tags', 'POST', { name: 'Газ (Отопление)', propertyFeature: { name: 'Газ', group: 'heating' } })).json(),
    { id: 'tag', name: 'Газ (Отопление)', propertyFeature: { id: 'feature', name: 'Газ', group: 'heating' } });
  assert.deepEqual(calls.mock.calls[1]!.arguments[0], { data: { name: 'Газ (Отопление)', propertyFeature: { create: { name: 'Газ', group: 'heating' } } }, include: tagInclude });
});

test('unified dictionary preserves badge type and group and edits public label independently', async t => {
  const feature = { id: 'feature', name: 'Газ', group: 'heating' };
  const update = t.mock.fn(async (args: any) => ({ id: 'tag', name: args.data.name, propertyFeature: { ...feature, ...args.data.propertyFeature?.update } }));
  transaction(t, { tag: { findUnique: async () => ({ id: 'tag', name: 'Газ (Отопление)', propertyFeature: feature }), update } });
  const response = await request('/tags/tag', 'PUT', { name: 'Отопление газом', propertyFeature: { name: 'Газовое автономное' } });
  assert.equal(response.status, 200);
  assert.deepEqual(update.mock.calls[0]!.arguments[0].data, { name: 'Отопление газом', propertyFeature: { update: { name: 'Газовое автономное' } } });
  assert.equal((await request('/tags/tag', 'PUT', { name: 'Газ', propertyFeature: null })).status, 400);
  assert.equal((await request('/tags/tag', 'PUT', { name: 'Газ', propertyFeature: { name: 'Газ', group: 'other' } })).status, 400);
  assert.equal(update.mock.callCount(), 1);
});

test('deleting a badge-backed tag removes both definitions while ordinary tags stay independent', async t => {
  const removedTags = t.mock.fn(async (_args: any) => ({}));
  const removedFeatures = t.mock.fn(async (_args: any) => ({}));
  transaction(t, { tag: { findUnique: async ({ where }: any) => ({ propertyFeatureId: where.id === 'badge' ? 'feature' : null }), delete: removedTags },
    propertyFeature: { delete: removedFeatures } });
  assert.equal((await request('/tags/badge', 'DELETE')).status, 200);
  assert.equal((await request('/tags/ordinary', 'DELETE')).status, 200);
  assert.equal(removedTags.mock.callCount(), 2);
  assert.deepEqual(removedFeatures.mock.calls[0]!.arguments[0], { where: { id: 'feature' } });
  assert.equal(removedFeatures.mock.callCount(), 1);
});

test('badge article rules are rejected before task creation', async t => {
  const previous = { findUnique: db.tag.findUnique, create: db.tagTask.create };
  const createCall = t.mock.fn(async () => ({}));
  t.after(() => { db.tag.findUnique = previous.findUnique; db.tagTask.create = previous.create; });
  Object.assign(db.tag, { findUnique: async () => ({ id: 'tag', propertyFeatureId: 'feature' }) });
  Object.assign(db.tagTask, { create: createCall });
  const response = await request('/tasks', 'POST', { type: 'article', tag_id: 'tag', params: [{ param: 'title', value_contain: 'море' }] });
  assert.equal(response.status, 400);
  assert.equal(createCall.mock.callCount(), 0);
});
