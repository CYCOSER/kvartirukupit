import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, createError, createRouter, defineEventHandler, getHeader, setHeader, toWebHandler } from 'h3';
import { db } from '../server/utils/db';
import { agentPropertySelect } from '../server/utils/agent-properties';
import list from '../server/api/agent/v1/property-features/index.get';
import patch from '../server/api/agent/v1/properties/[id]/features.patch';

const token = 'a-secure-random-agent-token-with-at-least-32-characters';
const features = [
  { id: 'sea', name: 'У моря', group: 'location' },
  { id: 'gas', name: 'Газовое', group: 'heating' },
  { id: 'central', name: 'Центральное', group: 'heating' },
];

async function fixture(t: TestContext, current: Record<string, unknown> | null = {
  features: [features[0]], featureOverrides: ['location'],
}, secured = false) {
  const globals = globalThis as any;
  const replacements = {
    defineEventHandler, getHeader, setHeader, createError,
    useRuntimeConfig: () => ({ agentApiToken: token, public: { siteUrl: 'https://example.com' } }),
    checkOrigin: () => { throw createError({ statusCode: 403 }); },
    requireAdmin: () => { throw createError({ statusCode: 401 }); },
  };
  const originals = Object.fromEntries(Object.keys(replacements).map(key => [key, globals[key]]));
  Object.assign(globals, replacements);
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globals[key];
      else globals[key] = value;
    }
  });
  const originalCatalog = db.propertyFeature.findMany;
  const originalTransaction = db.$transaction;
  const catalog = t.mock.fn(async (..._args: any[]) => features);
  const findUnique = t.mock.fn(async (..._args: any[]) => current);
  const update = t.mock.fn(async (args: any) => ({ id: 'one', ...args.data }));
  const findFeatures = t.mock.fn(async (args: any) => features.filter(feature => args.where.id.in.includes(feature.id)));
  const tagFind = t.mock.fn(async (..._args: any[]) => [{ id: 'sea-tag' }]);
  const tagDelete = t.mock.fn(async (..._args: any[]) => ({ count: 0 }));
  const tagCreate = t.mock.fn(async (..._args: any[]) => ({ count: 1 }));
  const lock = t.mock.fn(async (..._args: any[]) => 1);
  const transaction = t.mock.fn(async (callback: any) => callback({
    $executeRaw: lock, property: { findUnique, update }, propertyFeature: { findMany: findFeatures },
    tag: { findMany: tagFind }, tagRelation: { deleteMany: tagDelete, createMany: tagCreate },
  }));
  db.propertyFeature.findMany = catalog as any;
  db.$transaction = transaction as any;
  t.after(() => {
    db.propertyFeature.findMany = originalCatalog;
    db.$transaction = originalTransaction;
  });
  const { default: security } = await import('../server/middleware/security');
  const router = createRouter()
    .get('/api/agent/v1/property-features', list)
    .patch('/api/agent/v1/properties/:id/features', patch)
    .get('/api/admin/property-features', list);
  const app = createApp();
  if (secured) app.use(security);
  const handle = toWebHandler(app.use(router));
  const request = (body?: unknown, authorization = `Bearer ${token}`, path = '/api/agent/v1/properties/one/features') => {
    const json = body === undefined ? undefined : JSON.stringify(body);
    return handle(new Request(`https://example.com${path}`, {
      method: json === undefined ? 'GET' : 'PATCH',
      headers: { Authorization: authorization, Cookie: 'kv_session=admin',
        ...(json === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(json)) }) },
      body: json,
    }));
  };
  return { request, catalog, findUnique, update, findFeatures, transaction, lock, tagFind, tagDelete, tagCreate };
}

test('feature routes require agent authentication and do not unlock admin routes', async (t) => {
  const f = await fixture(t, undefined, true);
  assert.equal((await f.request({ featureIds: [] }, '')).status, 401);
  assert.equal((await f.request(undefined, '', '/api/agent/v1/property-features')).status, 401);
  assert.equal((await f.request(undefined, `Bearer ${token}`, '/api/admin/property-features')).status, 401);
  assert.equal(f.transaction.mock.callCount(), 0);
  assert.equal(f.catalog.mock.callCount(), 0);
  const response = await f.request(undefined, `Bearer ${token}`, '/api/agent/v1/property-features');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), features);
  assert.deepEqual(f.catalog.mock.calls[0]!.arguments[0], { orderBy: [{ group: 'asc' }, { name: 'asc' }] });
});

test('feature PATCH preserves unrelated fields, deduplicates IDs and synchronizes linked tags', async (t) => {
  const f = await fixture(t);
  f.update.mock.mockImplementation(async (args: any) => {
    assert.equal(f.tagDelete.mock.callCount(), 1);
    assert.equal(f.tagCreate.mock.callCount(), 1);
    return { id: 'one', ...args.data };
  });
  const response = await f.request({ featureIds: [' sea ', 'sea'] });
  assert.equal(response.status, 200);
  assert.equal(f.lock.mock.callCount(), 1);
  assert.deepEqual(f.update.mock.calls[0]!.arguments[0], {
    where: { id: 'one' }, data: { features: { set: [{ id: 'sea' }] } }, select: agentPropertySelect,
  });
  assert.deepEqual(f.tagFind.mock.calls[0]!.arguments[0], {
    where: { propertyFeatureId: { in: ['sea'] } }, select: { id: true },
  });
  assert.deepEqual(f.tagCreate.mock.calls[0]!.arguments[0], {
    data: [{ tagId: 'sea-tag', propertyId: 'one' }], skipDuplicates: true,
  });
});

test('feature PATCH supports overrides-only changes and explicit clearing', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request({ featureOverrides: ['location', 'location', 'other'] })).status, 200);
  assert.deepEqual(f.update.mock.calls[0]!.arguments[0].data, { featureOverrides: ['location', 'other'] });
  assert.equal(f.tagFind.mock.callCount(), 0);
  assert.equal((await f.request({ featureIds: [], featureOverrides: [] })).status, 200);
  assert.deepEqual(f.update.mock.calls[1]!.arguments[0].data, { features: { set: [] }, featureOverrides: [] });
  assert.equal(f.tagDelete.mock.callCount(), 1);
});

test('feature PATCH rejects malformed or unrelated fields before reading the database', async (t) => {
  const f = await fixture(t);
  for (const body of [{}, { price: 1 }, { featureIds: [], description: 'overwrite' },
    { featureIds: null }, { featureIds: [''] }, { featureIds: ['x'.repeat(101)] },
    { featureIds: Array(201).fill('sea') }, { featureOverrides: ['unknown'] },
    { featureOverrides: Array(5).fill('location') }]) {
    assert.equal((await f.request(body)).status, 400, JSON.stringify(body));
  }
  assert.equal(f.transaction.mock.callCount(), 0);
});

test('feature PATCH rejects deleted IDs, heating conflicts and missing group overrides without writes', async (t) => {
  const f = await fixture(t);
  for (const body of [{ featureIds: ['deleted'] }, { featureOverrides: [] },
    { featureIds: ['gas'], featureOverrides: ['location'] },
    { featureIds: ['gas', 'central'], featureOverrides: ['heating'] }]) {
    assert.equal((await f.request(body)).status, 400, JSON.stringify(body));
  }
  assert.equal(f.update.mock.callCount(), 0);
  assert.equal(f.tagDelete.mock.callCount(), 0);
});

test('feature PATCH returns 404 for a missing property without writes', async (t) => {
  const f = await fixture(t, null);
  assert.equal((await f.request({ featureIds: [] })).status, 404);
  assert.equal(f.update.mock.callCount(), 0);
  assert.equal(f.findFeatures.mock.callCount(), 0);
});
