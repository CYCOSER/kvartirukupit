import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp, createError, createRouter, defineEventHandler, getHeader, readBody, readMultipartFormData, setHeader, toNodeListener, toWebHandler } from 'h3';

const token = 'a-secure-random-agent-token-with-at-least-32-characters';

async function fixture(t: TestContext, configured: unknown = token, nodeTransport = false) {
  const globals = globalThis as any;
  const replacements = {
    defineEventHandler, getHeader, setHeader, createError,
    useRuntimeConfig: () => ({ agentApiToken: configured, public: { siteUrl: 'https://example.com' } }),
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
  const handler = defineEventHandler(async event => {
    if (getHeader(event, 'content-type')?.startsWith('multipart/form-data'))
      return { size: (await readMultipartFormData(event))?.[0]?.data.length };
    if (['POST', 'PUT', 'PATCH'].includes(event.method)) return { body: await readBody(event) };
    return { ok: true };
  });
  const router = createRouter({ preemptive: true })
    .use('/api/agent/v1/articles', handler)
    .use('/api/agent/v1/articles/:id/image', handler)
    .use('/api/admin/articles', handler);
  const app = createApp().use(security).use(router.handler);
  let origin = 'https://example.com';
  let handle = toWebHandler(app);
  if (nodeTransport) {
    const server = createServer(toNodeListener(app));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    handle = request => fetch(request);
  }
  return (path = '/api/agent/v1/articles', init: RequestInit = {}) => handle(new Request(origin + path, init));
}

test('agent bearer token authorizes requests without cookies or Origin and disables caching', async t => {
  const request = await fixture(t);
  const response = await request(undefined, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('missing, incorrect and malformed agent tokens fail even with an admin cookie', async t => {
  const request = await fixture(t);
  for (const authorization of ['', 'Bearer wrong', `Basic ${token}`, `Bearer ${token} extra`]) {
    const response = await request(undefined, { headers: { Authorization: authorization, Cookie: 'kv_session=admin' } });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('unknown paths and bare agent namespace are protected', async t => {
  const request = await fixture(t);
  for (const path of ['/api/agent', '/api/agent/', '/api/agent/unknown'])
    assert.equal((await request(path)).status, 401);
});

test('encoded route prefixes cannot bypass agent or admin authentication', async t => {
  const request = await fixture(t);
  for (const path of ['/api/%61gent/v1/articles', '/%61pi/agent/v1/articles', '/api/a%67ent/v1/articles']) {
    assert.equal((await request(path)).status, 401, path);
    assert.equal((await request(path, { headers: { Authorization: `Bearer ${token}` } })).status, 200, path);
  }
  for (const path of ['/api/%61dmin/articles', '/%61pi/admin/articles'])
    assert.equal((await request(path, { headers: { Authorization: `Bearer ${token}` } })).status, 401, path);
  for (const path of ['/API/agent/v1/articles', '/api%2Fagent/v1/articles', '/api/%2561gent/v1/articles'])
    assert.equal((await request(path)).status, 404, path);
});

for (const configured of ['', 'short-token', ' '.repeat(32), 'я'.repeat(32)]) {
  test(`agent API fails closed for invalid configured token ${JSON.stringify(configured)}`, async t => {
    const request = await fixture(t, configured);
    const response = await request(undefined, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 503);
  });
}

test('agent bearer token does not bypass admin session or Origin checks', async t => {
  const request = await fixture(t);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Length': '2', 'Content-Type': 'application/json' };
  assert.equal((await request('/api/admin/articles', { headers })).status, 401);
  assert.equal((await request('/api/admin/articles', { method: 'POST', headers, body: '{}' })).status, 403);
});

test('agent JSON body accepts Cyrillic article text and remains readable by routes', async t => {
  const request = await fixture(t, token, true);
  const body = JSON.stringify({ content: 'я'.repeat(50000) });
  const response = await request(undefined, {
    method: 'POST', body,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(Buffer.byteLength(body)) },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).body?.content?.length, 50000);
});

test('agent writes reject wrong media type, missing length and oversized actual body', async t => {
  const request = await fixture(t);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  assert.equal((await request(undefined, { method: 'POST', body: '{}', headers: { ...headers, 'Content-Type': 'text/plain', 'Content-Length': '2' } })).status, 415);
  assert.equal((await request(undefined, { method: 'POST', body: '{}', headers })).status, 411);
  assert.equal((await request(undefined, { method: 'POST', body: '{}', headers: { ...headers, 'Content-Length': String(256 * 1024 + 1) } })).status, 413);
  assert.equal((await request(undefined, { method: 'POST', body: 'x'.repeat(256 * 1024 + 1), headers: { ...headers, 'Content-Length': '2' } })).status, 413);
});

test('only article cover uploads accept multipart and use the larger size limit', async t => {
  const request = await fixture(t);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data; boundary=test', 'Content-Length': String(12 * 1024 * 1024 + 1) };
  assert.equal((await request('/api/agent/v1/articles/article-id/image', { method: 'POST', headers, body: 'test' })).status, 413);
  assert.equal((await request('/api/agent/v1/articles', { method: 'POST', headers, body: 'test' })).status, 415);
});

test('article cover multipart body remains readable after authorization', async t => {
  const request = await fixture(t, token, true);
  const size = 300 * 1024;
  const body = `--test\r\nContent-Disposition: form-data; name="file"; filename="cover.png"\r\nContent-Type: image/png\r\n\r\n${'x'.repeat(size)}\r\n--test--\r\n`;
  const response = await request('/api/%61gent/v1/articles/article-id/%69mage?test=1', {
    method: 'POST', body,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data; boundary=test', 'Content-Length': String(Buffer.byteLength(body)) },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { size });
});
