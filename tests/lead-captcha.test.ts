import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, createError, defineEventHandler, getHeader, readBody, toWebHandler } from 'h3';

const lead = { phone: '+7 (900) 123-45-67', consent: true, captchaToken: 'verified-token' };

async function fixture(t: TestContext) {
  const config = {
    smartCaptchaSecretKey: 'server-secret', trustProxy: false,
    public: { siteUrl: 'https://example.com', smartCaptchaSiteKey: 'site-key' },
  };
  const writes: any[] = [];
  const validations: URLSearchParams[] = [];
  let provider: () => Promise<Response> = async () => Response.json({ status: 'ok', host: 'example.com' });
  const globals = globalThis as any;
  const replacements = {
    defineEventHandler, createError, readBody, useRuntimeConfig: () => config,
    checkOrigin: (event: any) => {
      if (getHeader(event, 'origin') !== new URL(config.public.siteUrl).origin)
        throw createError({ statusCode: 403 });
    },
    limit: () => {},
    db: {
      property: { findFirst: async () => ({ id: 'property' }) },
      lead: { create: async (input: any) => { writes.push(input.data); } },
    },
  };
  const originals = Object.keys(replacements).map(name => [name, globals[name]] as const);
  Object.assign(globals, replacements);
  t.after(() => {
    for (const [name, value] of originals) {
      if (value === undefined) delete globals[name];
      else globals[name] = value;
    }
  });
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://smartcaptcha.cloud.yandex.ru/validate');
    assert.equal(init.method, 'POST');
    assert.ok(init.signal instanceof AbortSignal);
    validations.push(init.body as URLSearchParams);
    return provider();
  });
  const { default: handler } = await import('../server/api/leads.post');
  const handle = toWebHandler(createApp().use(handler));
  return {
    config, writes, validations,
    provider: (next: typeof provider) => { provider = next; },
    request: (body: unknown = lead, origin = new URL(config.public.siteUrl).origin) => handle(new Request(config.public.siteUrl + '/api/leads', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })),
  };
}

test('a verified captcha saves the lead without the token and verifies server-side', async t => {
  const f = await fixture(t);
  assert.equal((await f.request()).status, 200);
  assert.equal(f.validations.length, 1);
  assert.equal(f.validations[0].get('secret'), 'server-secret');
  assert.equal(f.validations[0].get('token'), lead.captchaToken);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].phone, '+79001234567');
  assert.equal('captchaToken' in f.writes[0], false);
  assert.equal('website' in f.writes[0], false);
});

test('missing tokens, forged origins and malformed lead data never reach captcha or storage', async t => {
  const f = await fixture(t);
  assert.equal((await f.request({ ...lead, captchaToken: '' })).status, 403);
  assert.equal((await f.request({ phone: lead.phone, consent: true })).status, 403);
  assert.equal((await f.request(lead, 'https://evil.example')).status, 403);
  assert.equal((await f.request({ ...lead, captchaToken: 'x'.repeat(4097) })).status, 400);
  assert.equal(f.validations.length, 0);
  assert.equal(f.writes.length, 0);
});

test('invalid, expired, replayed and foreign-host tokens cannot save leads', async t => {
  const f = await fixture(t);
  for (const response of [
    { status: 'failed' }, { status: 'ok', host: '' }, { status: 'ok' },
    { status: 'ok', host: 'example.com.evil' }, { status: 'ok', host: 'example.com:8080' },
    { status: 'ok', host: 'example.com/path' }, { status: 'ok', host: 'evil@example.com' },
  ]) {
    f.provider(async () => Response.json(response));
    assert.equal((await f.request()).status, 403);
  }
  assert.equal(f.writes.length, 0);
  let used = false;
  f.provider(async () => {
    const response = used ? { status: 'failed' } : { status: 'ok', host: 'example.com' };
    used = true;
    return Response.json(response);
  });
  assert.equal((await f.request()).status, 200);
  assert.equal((await f.request()).status, 403);
  assert.equal(f.writes.length, 1);
});

test('internationalized captcha domains and local development ports are matched correctly', async t => {
  const f = await fixture(t);
  f.config.public.siteUrl = 'https://квартирыкупить.рф';
  f.provider(async () => Response.json({ status: 'ok', host: 'квартирыкупить.рф' }));
  assert.equal((await f.request()).status, 200);
  f.config.public.siteUrl = 'http://localhost:3101';
  f.provider(async () => Response.json({ status: 'ok', host: 'localhost:3101' }));
  assert.equal((await f.request()).status, 200);
});

test('unconfigured captcha and provider outages fail closed without writing leads', async t => {
  const f = await fixture(t);
  f.config.smartCaptchaSecretKey = '';
  assert.equal((await f.request()).status, 503);
  f.config.smartCaptchaSecretKey = 'server-secret';
  f.config.public.smartCaptchaSiteKey = '';
  assert.equal((await f.request()).status, 503);
  assert.equal(f.validations.length, 0);
  f.config.public.smartCaptchaSiteKey = 'site-key';
  for (const provider of [
    async () => new Response('unavailable', { status: 503 }),
    async () => new Response('invalid json'),
    async () => Response.json(null),
    async () => Response.json({}),
    async () => { throw new DOMException('Timed out', 'TimeoutError'); },
  ]) {
    f.provider(provider);
    assert.equal((await f.request()).status, 503);
  }
  assert.equal(f.writes.length, 0);
});

test('honeypot submissions produce no lead or captcha request', async t => {
  const f = await fixture(t);
  assert.equal((await f.request({ ...lead, website: 'https://spam.example' })).status, 200);
  assert.equal(f.validations.length, 0);
  assert.equal(f.writes.length, 0);
});
