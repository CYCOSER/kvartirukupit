import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp, createError, createRouter, defineEventHandler, getHeader, setHeader, toNodeListener } from 'h3';
import { db } from '../server/utils/db';
import list from '../server/api/agent/v1/tags/index.get';
import create from '../server/api/agent/v1/tags/index.post';
import rename from '../server/api/agent/v1/tags/[id].put';
import remove from '../server/api/agent/v1/tags/[id].delete';
import assign from '../server/api/agent/v1/tags/relations.post';
import { tagInclude } from '../server/utils/tag-definitions';

const token = 'secure-agent-test-token-with-at-least-32-characters';

async function fixture(t: TestContext) {
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
  const { default: security } = await import('../server/middleware/security');
  const router = createRouter()
    .get('/api/agent/v1/tags', list).post('/api/agent/v1/tags', create)
    .put('/api/agent/v1/tags/:id', rename).delete('/api/agent/v1/tags/:id', remove)
    .post('/api/agent/v1/tags/relations', assign).get('/api/admin/tags', list);
  const server = createServer(toNodeListener(createApp().use(security).use(router.handler)));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return (path: string, method = 'GET', body?: unknown, authenticated = true) => {
    const json = body === undefined ? undefined : JSON.stringify(body);
    return fetch(`${origin}${path}`, {
      method,
      headers: {
        ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
        ...(json === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(json)) }),
      },
      body: json,
    });
  };
}

test('all agent tag routes require bearer authentication and cannot authorize admin routes', async t => {
  const request = await fixture(t);
  for (const [path, method] of [
    ['/api/agent/v1/tags', 'GET'], ['/api/agent/v1/tags', 'POST'],
    ['/api/agent/v1/tags/tag', 'PUT'], ['/api/agent/v1/tags/tag', 'DELETE'],
    ['/api/agent/v1/tags/relations', 'POST'],
  ]) {
    const response = await request(path!, method!, undefined, false);
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await request('/api/admin/tags')).status, 401);
});

test('agent tag catalogue includes linked icons and mutation validation stays strict', async t => {
  const request = await fixture(t);
  const previous = db.tag.findMany;
  const tags = [{ id: 'tag', name: 'Парк', propertyFeatureId: 'park', propertyFeature: { id: 'park', name: 'Рядом парк', group: 'location' } }];
  const findMany = t.mock.fn(async (..._args: any[]) => tags);
  db.tag.findMany = findMany as typeof db.tag.findMany;
  t.after(() => { db.tag.findMany = previous; });
  const response = await request('/api/agent/v1/tags');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), tags);
  assert.deepEqual(findMany.mock.calls[0]!.arguments[0], { orderBy: { name: 'asc' }, include: tagInclude });
  assert.equal((await request('/api/agent/v1/tags', 'POST', { name: 'Тег', unknown: true })).status, 400);
  assert.equal((await request('/api/agent/v1/tags/tag', 'PUT', { name: 'Тег', propertyFeature: { name: 'Парк', group: 'other' } })).status, 400);
});

test('agent assignment adds ordinary tags to deduplicated targets without replacing existing relations', async t => {
  const request = await fixture(t);
  const previous = db.$transaction;
  const createMany = t.mock.fn(async (_args: any) => ({ count: 1 }));
  const lock = t.mock.fn(async () => 1);
  db.$transaction = (async (run: any) => run({
    $executeRaw: lock,
    tag: { findUnique: async () => ({ id: 'tag', name: 'Тег', propertyFeature: null }) },
    property: { count: async () => 1 },
    article: { count: async () => 1 },
    tagRelation: { createMany },
  })) as typeof db.$transaction;
  t.after(() => { db.$transaction = previous; });
  const response = await request('/api/agent/v1/tags/relations', 'POST', {
    tag_id: 'tag', property_ids: ['property', 'property'], article_ids: ['article'],
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(lock.mock.callCount(), 1);
  assert.deepEqual(createMany.mock.calls.map(call => call.arguments[0]), [
    { data: [{ tagId: 'tag', propertyId: 'property' }], skipDuplicates: true },
    { data: [{ tagId: 'tag', articleId: 'article' }], skipDuplicates: true },
  ]);
  assert.deepEqual(await response.json(), {
    propertyRelationsCreated: 1, articleRelationsCreated: 1, badgesAssigned: 0, skippedCount: 0,
    skipped: { secondary: 0, heatingConflict: 0, clearedGroup: 0, limit: 0 },
  });
});
