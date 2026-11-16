import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { createApp, createError, createEvent, defineEventHandler, getHeader, toWebHandler, type H3Event } from 'h3';
import { clientIp, enforceRateLimit } from '../server/utils/rate-limit';
import botProtection from '../server/middleware/bot-protection';

let clock = Date.now();

function fixture(t: TestContext, trustProxy: boolean | string = false) {
  clock += 100000000;
  t.mock.method(Date, 'now', () => clock);
  const globals = globalThis as any;
  const originalConfig = globals.useRuntimeConfig;
  const originalOrigin = globals.checkOrigin;
  globals.useRuntimeConfig = () => ({ trustProxy });
  globals.checkOrigin = (event: H3Event) => {
    if (getHeader(event, 'origin') !== 'https://example.com')
      throw createError({ statusCode: 403 });
  };
  t.after(() => {
    globals.useRuntimeConfig = originalConfig;
    globals.checkOrigin = originalOrigin;
  });
}

function event(
  ip: string | null = '192.0.2.1',
  headers: Record<string, string> = {},
  path = '/',
  method = 'GET',
) {
  const socket = new Socket();
  Object.defineProperty(socket, 'remoteAddress', { value: ip ?? undefined });
  const req = new IncomingMessage(socket);
  req.headers = headers;
  req.url = path;
  req.method = method;
  return createEvent(req, new ServerResponse(req));
}

test('rate limits keep separate scopes and visitors and expire at the window boundary', t => {
  fixture(t);
  const first = event();
  enforceRateLimit(first, 'lead', 2, 10000);
  enforceRateLimit(first, 'lead', 2, 10000);
  assert.throws(() => enforceRateLimit(first, 'lead', 2, 10000), { statusCode: 429 });
  assert.equal(first.node.res.getHeader('Retry-After'), 10);
  assert.equal(first.node.res.getHeader('Cache-Control'), 'no-store');
  enforceRateLimit(event('192.0.2.2'), 'lead', 2, 10000);
  enforceRateLimit(first, 'login', 2, 10000);
  clock += 9001;
  assert.throws(() => enforceRateLimit(first, 'lead', 2, 10000), { statusCode: 429 });
  assert.equal(first.node.res.getHeader('Retry-After'), 1);
  clock += 999;
  enforceRateLimit(first, 'lead', 2, 10000);
});

test('forwarded IP headers cannot change the visitor with proxy trust disabled', t => {
  fixture(t, 'false');
  const request = event('192.0.2.1', {
    'x-real-ip': '198.51.100.1', 'x-forwarded-for': '198.51.100.2',
  });
  assert.equal(clientIp(request), '192.0.2.1');
  enforceRateLimit(request, 'lead', 1);
  request.node.req.headers['x-real-ip'] = '198.51.100.3';
  assert.throws(() => enforceRateLimit(request, 'lead', 1), { statusCode: 429 });
});

test('trusted proxy uses a valid X-Real-IP and ignores invalid values and X-Forwarded-For', t => {
  fixture(t, 'true');
  const request = event('192.0.2.1', { 'x-real-ip': '2001:db8::1' });
  assert.equal(clientIp(request), '2001:db8::1');
  request.node.req.headers['x-real-ip'] = '198.51.100.1, 198.51.100.2';
  request.node.req.headers['x-forwarded-for'] = '198.51.100.3';
  assert.equal(clientIp(request), '192.0.2.1');
  delete request.node.req.headers['x-real-ip'];
  assert.equal(clientIp(request), '192.0.2.1');
});

test('public API limits share a visitor budget across paths and preserve SSR visitor context', async t => {
  fixture(t);
  const page = event('192.0.2.7');
  await botProtection(page);
  assert.equal(page.context.clientAddress, '192.0.2.7');
  const paths = ['/api/properties/', '/api/articles?sort=new', '/api/map/search/'];
  for (let i = 0; i < 120; i++) {
    const request = event(null, {}, paths[i % paths.length], i % 2 ? 'HEAD' : 'GET');
    request.context.clientAddress = page.context.clientAddress;
    await botProtection(request);
  }
  assert.throws(() => botProtection(event('192.0.2.7', {}, '/api/properties')), { statusCode: 429 });
  await botProtection(event('192.0.2.8', {}, '/api/properties'));
  for (const path of ['/', '/catalog/example', '/robots.txt', '/sitemap.xml', '/api/health', '/api/admin/me', '/api/agent/v1/articles'])
    await botProtection(event('192.0.2.7', {}, path));
  const app = createApp()
    .use(defineEventHandler(request => { request.context.clientAddress = '192.0.2.7'; }))
    .use(botProtection)
    .use(defineEventHandler(() => ({ ok: true })));
  const response = await toWebHandler(app)(new Request('https://example.com/api/%61rticles'));
  assert.equal(response.status, 429);
});

test('article mutations require the site origin and share a rate limit across slugs and actions', async t => {
  fixture(t);
  assert.throws(() => botProtection(event('192.0.2.1', {}, '/api/articles/example/view', 'POST')), { statusCode: 403 });
  const headers = { origin: 'https://example.com' };
  for (let i = 0; i < 30; i++)
    await botProtection(event('192.0.2.1', headers, `/api/articles/item-${i}/${i % 2 ? 'view' : 'useful'}/`, 'POST'));
  assert.throws(() => botProtection(event('192.0.2.1', headers, '/api/articles/example/view', 'POST')), { statusCode: 429 });
  await botProtection(event('192.0.2.2', headers, '/api/articles/example/view', 'POST'));
});

test('internal calls without a socket or visitor context do not share a global bucket', t => {
  fixture(t);
  const internal = event(null);
  for (let i = 0; i < 130; i++) enforceRateLimit(internal, 'public-api', 1);
});

test('counter capacity is bounded without evicting active limits and recovers after expiry', t => {
  fixture(t);
  const request = event();
  for (let i = 0; i < 10000; i++) enforceRateLimit(request, `capacity-${i}`, 1, 60000);
  assert.throws(() => enforceRateLimit(request, 'overflow', 1, 60000), { statusCode: 429 });
  assert.throws(() => enforceRateLimit(request, 'capacity-0', 1, 60000), { statusCode: 429 });
  assert.equal(request.node.res.getHeader('Retry-After'), 60);
  clock += 60000;
  enforceRateLimit(request, 'overflow', 1, 60000);
});
