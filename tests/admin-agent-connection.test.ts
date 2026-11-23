import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, createError, createRouter, defineEventHandler, getHeader, getQuery, setHeader, toWebHandler } from 'h3';

const token = 'a-fake-api-token-for-admin-connection-tests-only';

async function fixture(t: TestContext, configured: unknown = token) {
  const globals = globalThis as any;
  const replacements = {
    defineEventHandler, getHeader, getQuery, setHeader, createError,
    useRuntimeConfig: () => ({ agentApiToken: configured, public: { siteUrl: 'https://example.com' } }),
    checkOrigin: () => { throw createError({ statusCode: 403 }); },
    requireAdmin: (event: Parameters<typeof getHeader>[0]) => {
      if (getHeader(event, 'cookie') !== 'kv_session=authenticated-admin') throw createError({ statusCode: 401 });
      return { id: 'admin' };
    },
  };
  const originals = Object.fromEntries(Object.keys(replacements).map(key => [key, globals[key]]));
  Object.assign(globals, replacements);
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globals[key]; else globals[key] = value;
    }
  });
  const { default: security } = await import('../server/middleware/security');
  const { default: handler } = await import('../server/api/admin/agent-connection.get');
  const router = createRouter().get('/api/admin/agent-connection', handler);
  const handle = toWebHandler(createApp().use(security).use(router.handler));
  return (reveal = '', authenticated = true, authorization = '') => handle(new Request(
    `https://example.com/api/admin/agent-connection${reveal ? `?reveal=${reveal}` : ''}`,
    { headers: { Cookie: authenticated ? 'kv_session=authenticated-admin' : '', Authorization: authorization } },
  ));
}

test('admin API connection metadata never includes the key', async t => {
  const request = await fixture(t);
  for (const reveal of ['', 'true', '0']) {
    const response = await request(reveal);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { enabled: true, token: null });
  }
});

test('revealing API credentials requires an admin session, not an API token', async t => {
  const request = await fixture(t);
  for (const authorization of ['', `Bearer ${token}`]) {
    const response = await request('1', false, authorization);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(!(await response.text()).includes(token));
  }
});

test('authenticated admin can explicitly reveal an uncached API key', async t => {
  const response = await (await fixture(t))('1');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { enabled: true, token });
});

for (const configured of ['', 'short-token', ' '.repeat(32), 'я'.repeat(32), undefined]) {
  test(`invalid API configuration stays disabled (${String(configured).length} characters)`, async t => {
    const response = await (await fixture(t, configured === undefined ? null : configured))('1');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { enabled: false, token: null });
  });
}
