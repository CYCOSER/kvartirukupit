import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRf39Response, rf39Draft, rf39ImageUrl, rf39IsComplex, rf39LayoutDraft, rf39Number, rf39Summary } from '../server/utils/rf39-data';
import { fetchRf39Objects, rf39ReadBody } from '../server/utils/rf39';

const fixture = {
  id: 123, title: 'Трёхкомнатная квартира', type: 'Квартиры - вторичное жильё', deal_type: 'sale',
  city: 'Калининград', address: 'Тестовая улица, 1', price: '9 200 000',
  coordinates: ['54.7', '20.3'], description: 'Описание<br>квартиры',
  images: ['/var/www/jokercrm/web/images/objects/123/photo.jpg'],
  params: { area: { name: 'Площадь', value: '90,5 м²' }, rooms: { value: '3' },
    floor: { value: '4' }, 'floors-total': { value: '7' }, renovation: { value: 'Чистовая' } },
  contact: { phone: 'PRIVATE_CONTACT', name: 'PRIVATE_NAME' }, agent: { email: 'PRIVATE_EMAIL' },
  url: 'https://crm.rf39.ru/private?token=PRIVATE_TOKEN', crm_params: { private: 'PRIVATE_DATA' },
};
const parse = (value: unknown = fixture) => parseRf39Response({ code: 200, data: { '123': value } })[0]!;

test('RF39 maps a real response shape into an unpublished editable card without private fields', () => {
  const item = parse();
  const draft = rf39Draft(item);
  assert.equal(draft.data.title, '3-к кв. 90.5 м²');
  assert.equal(draft.data.type, 'apartment');
  assert.equal(draft.data.price, 9200000);
  assert.equal(draft.data.area, 90.5);
  assert.equal(draft.data.bedrooms, 3);
  assert.equal(draft.data.floors, 7); // Floor count, not the apartment's floor.
  assert.equal(draft.data.finish, 'Чистовая');
  assert.equal(draft.data.readiness, 'Уточняется');
  assert.equal(draft.data.description, 'Описание\nквартиры');
  assert.equal(draft.data.published, false);
  assert.equal(draft.data.featured, false);
  assert.equal(draft.data.elite, false);
  assert.equal(draft.data.sourceId, 'rf39:123');
  assert.equal(rf39Summary(item).area, 90.5);
  assert.equal(rf39Summary(item).bedrooms, 3);
  assert.equal(rf39Summary(item).floors, 7);
  assert.deepEqual(draft.imageUrls, ['https://crm.rf39.ru/images/objects/123/photo.jpg']);
  assert.deepEqual(draft.planImageUrls, []);
  assert.equal(JSON.stringify([item, draft, rf39Summary(item)]).includes('PRIVATE_'), false);
});

test('RF39 corpus remains a complex without borrowing characteristics from an arbitrary layout', () => {
  const item = parse({ ...fixture, type: 'Квартиры в новостройках',
    layouts: { 77: { id: 77, price: '100', params: fixture.params } },
    params: { 'built-year': { value: '2026 г.' }, 'ready-quarter': { value: '4' }, 'building-state': { value: 'строится' } },
    development: { title: 'ЖК', developer: { title: 'Застройщик' } },
  });
  const draft = rf39Draft(item);
  assert.equal(draft.data.type, 'complex');
  assert.equal(draft.data.area, null);
  assert.equal(draft.data.bedrooms, null);
  assert.equal(draft.data.price, 9200000);
  assert.equal(draft.data.priceKind, null);
  assert.equal(draft.data.developer, 'Застройщик');
  assert.equal(draft.data.readiness, 'IV кв. 2026');
  assert.equal(rf39Summary(item).layoutCount, 1);
  assert.equal(rf39Summary(item).area, null);
  assert.equal(rf39Summary(item).bedrooms, null);
  assert.equal(rf39Summary(item).developer, 'Застройщик');
  assert.match(draft.warnings.join(' '), /отдельные квартиры не создавались/);
});

test('RF39 recognizes an empty corpus conservatively without turning studios or incomplete apartments into a complex', () => {
  const corpus = { ...fixture, type: 'Квартиры в новостройках', title: 'ЖК «Светлогорск-3» Дом 16',
    complex: { id: 782, title: 'Дом 16' }, params: {}, layouts: [] };
  const item = parse(corpus);
  assert.equal(rf39IsComplex(item), true);
  assert.equal(rf39Draft(item).data.type, 'complex');
  for (const fields of [{ complex: null }, { title: 'Квартира в ЖК «Светлогорск-3»' },
    { apartment: '5' }, { params: { rooms: { value: '0' } } }, { params: { area: { value: '24 м²' } } },
    { title: 'Неизвестный объект' }, { type: 'Квартиры - вторичное жильё' }]) {
    assert.equal(rf39IsComplex(parse({ ...corpus, ...fields })), false);
  }
});

test('RF39 layout creates its own apartment identity and characteristics while inheriting only building context', () => {
  const parent = parse({ ...fixture, id: 17209, type: 'Квартиры в новостройках', title: 'ЖК «Светлогорск-3» Дом 16',
    development: { id: 293, title: 'ЖК «Светлогорск-3»', developer: { title: 'Застройщик' } },
    complex: { id: 782, title: 'Дом 16' },
    params: { ...fixture.params, 'built-year': { value: '2026 г.' }, 'ready-quarter': { value: '4' } },
    layouts: { 2775: { id: 2775, title: '2-к.квартира, 74.7 м², 1 эт.', apartment: '5', price: '13177080',
      description: 'Описание<br>планировки', images: ['https://crm.rf39.ru/images/objects/layouts/17209/plan.jpg'],
      params: { area: { value: '74.7 м²' }, rooms: { value: '2' }, floor: { value: '1' } } } },
  });
  const draft = rf39LayoutDraft(parent, 2775);
  assert.equal(draft.data.type, 'apartment');
  assert.equal(draft.data.sourceId, 'rf39-layout:17209:2775');
  assert.equal(draft.data.slug, 'rf39-layout-17209-2775');
  assert.equal(draft.data.title, '2-к кв. 74.7 м²');
  assert.equal(draft.data.description, 'Описание\nпланировки');
  assert.equal(draft.data.price, 13177080);
  assert.equal(draft.data.area, 74.7);
  assert.equal(draft.data.bedrooms, 2);
  assert.equal(draft.data.address, fixture.address);
  assert.equal(draft.data.location, fixture.city);
  assert.equal(draft.data.rf39ComplexId, '293');
  assert.equal(draft.data.rf39BuildingId, '782');
  assert.equal(draft.data.readiness, 'IV кв. 2026');
  assert.equal(draft.data.published, false);
  assert.deepEqual(draft.imageUrls, ['https://crm.rf39.ru/images/objects/layouts/17209/plan.jpg']);
  assert.equal(draft.warnings.some(warning => warning.includes('корпус/ЖК')), false);
  assert.throws(() => rf39LayoutDraft(parent, 17209), /не найдена/);
  assert.throws(() => rf39LayoutDraft({ ...parent, deal_type: 'rent' }, 2775), /не найдена/);
  const sparse = rf39LayoutDraft({ ...parent, layouts: [{ id: 2775 }] }, 2775);
  assert.equal(sparse.data.area, null);
  assert.equal(sparse.data.bedrooms, null);
  assert.equal(sparse.data.price, null);
  assert.equal(sparse.data.description, '');
  assert.deepEqual(sparse.imageUrls, []);
});

test('RF39 rejects unsupported sale categories and rentals on the server', () => {
  for (const data of [{ ...fixture, type: 'Дома, дачи, коттеджи' }, { ...fixture, deal_type: 'rent' }]) {
    const item = parse(data);
    assert.equal(rf39Summary(item).supported, false);
    assert.throws(() => rf39Draft(item), /продажу квартир/);
  }
});

test('RF39 only accepts public images on the fixed CRM host without query secrets', () => {
  for (const url of ['https://evil.test/images/objects/1/a.jpg', '//localhost/images/objects/1/a.jpg',
    'https://user:password@crm.rf39.ru/images/objects/1/a.jpg', '/images/objects/1/a.jpg?token=secret',
    '/images/objects/1/a.jpg#secret', '/images/objects/../../secret.jpg', '/etc/passwd', 'file:///tmp/a.jpg'])
    assert.equal(rf39ImageUrl(url), null, url);
  assert.equal(rf39ImageUrl('https://crm.rf39.ru/images/objects/layouts/123/a.jpg'), 'https://crm.rf39.ru/images/objects/layouts/123/a.jpg');
});

test('RF39 retains apartment layout fields and relation IDs without treating mixed galleries as plans', () => {
  const item = parse({ ...fixture, development: { id: 293, title: 'ЖК' }, complex: { id: 782, title: 'Дом 16', url: 'PRIVATE_URL' },
    layouts: { 2775: { id: 2775, title: 'Квартира', apartment: '5', price: '13177080',
      images: ['https://crm.rf39.ru/images/objects/layouts/17209/photo.jpg'], params: fixture.params,
      contact: { phone: 'PRIVATE_PHONE' } } } });
  const layout = Object.values(item.layouts!)[0]!;
  assert.equal(item.development?.id, 293);
  assert.equal(item.complex?.id, 782);
  assert.equal(rf39Draft(item).data.rf39ComplexId, '293');
  assert.equal(rf39Draft(item).data.rf39BuildingId, '782');
  assert.equal(layout.price, '13177080');
  assert.equal(layout.params?.area?.value, '90,5 м²');
  assert.equal(layout.images?.length, 1);
  assert.equal(JSON.stringify(item).includes('PRIVATE_'), false);
  assert.deepEqual(rf39Draft(item).planImageUrls, []);
});

test('RF39 parses prices and units conservatively and never treats malformed data as zero', () => {
  for (const value of ['', null, 'не указано', '-100', '10 млн', '4/7', '1e6', Infinity]) assert.equal(rf39Number(value), null);
  assert.equal(rf39Number('9\u00a0200\u00a0000 ₽'), 9200000);
  assert.equal(rf39Number('74,7 м²'), 74.7);
  assert.equal(rf39Draft(parse({ ...fixture, price: '0' })).data.price, null);
  for (const coordinates of [['', ''], [100, 200], ['not', 'numbers'], '54.7']) {
    const draft = rf39Draft(parse({ ...fixture, coordinates }));
    assert.equal(draft.data.latitude, null);
    assert.equal(draft.data.longitude, null);
  }
  assert.equal(rf39Draft(parse({ ...fixture, coordinates: '54.7 20.3' })).data.longitude, 20.3);
});

test('RF39 validates the envelope rather than treating errors or invalid IDs as an empty catalog', () => {
  assert.deepEqual(parseRf39Response({ code: 200, data: [] }), []);
  assert.throws(() => parseRf39Response({ code: 401, data: [] }));
  assert.throws(() => parseRf39Response({ code: 200 }));
  assert.throws(() => parse({ ...fixture, id: '../private' }));
  assert.throws(() => parseRf39Response({ code: 200, data: [fixture, fixture] }), /страница/);
});

test('RF39 downloads are bounded even without a Content-Length header', async () => {
  assert.equal((await rf39ReadBody(new Response('abc'), 3)).toString(), 'abc');
  await assert.rejects(rf39ReadBody(new Response('abcd'), 3), /too large/);
  await assert.rejects(rf39ReadBody(new Response('oops', { status: 502 }), 10));
});

test('RF39 sends the token in the POST body and does not forward credential-bearing upstream errors', async (t) => {
  let target = '';
  let options: RequestInit | undefined;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    target = url; options = init;
    return new Response(JSON.stringify({ code: 200, data: { 123: fixture } }));
  });
  await fetchRf39Objects('SECRET_TEST_TOKEN', 0, 123);
  assert.equal(target, 'https://crm.rf39.ru/api/objects');
  assert.equal(options?.method, 'POST');
  assert.equal(options?.redirect, 'error');
  const body = options?.body as URLSearchParams;
  assert.equal(body.get('token'), 'SECRET_TEST_TOKEN');
  assert.deepEqual(JSON.parse(body.get('params')!), { limit: 1, offset: 0, filter: { published: true, archived: false, id: 123 } });
  await fetchRf39Objects('SECRET_TEST_TOKEN', 100);
  assert.equal((options?.body as URLSearchParams).get('full'), '1');
  assert.equal(JSON.parse((options?.body as URLSearchParams).get('params')!).offset, 100);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('SECRET_TEST_TOKEN PRIVATE_CONTACT'); });
  await assert.rejects(fetchRf39Objects('SECRET_TEST_TOKEN'), error => {
    assert.equal(JSON.stringify(error).includes('SECRET_TEST_TOKEN'), false);
    return true;
  });
});

test('RF39 retries a failed connection once while preserving the private POST body and eligibility filter', async t => {
  const bodies: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    bodies.push(String(init.body));
    if (bodies.length === 1) throw new TypeError('PRIVATE_TOKEN connection failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } });
    return new Response(JSON.stringify({ code: 200, data: [fixture] }));
  });
  const result = await fetchRf39Objects('PRIVATE_TOKEN', 0, 123);
  assert.equal(result[0]!.id, 123);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  const body = new URLSearchParams(bodies[0]);
  assert.equal(body.get('token'), 'PRIVATE_TOKEN');
  assert.deepEqual(JSON.parse(body.get('params')!).filter, { published: true, archived: false, id: 123 });
});

test('RF39 does not retry invalid responses, authorization failures or unrecognized errors, and stops after the second timeout', async t => {
  for (const mode of ['schema', '401', '403', 'other', 'timeout']) {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      if (mode === 'schema') return new Response(JSON.stringify({ code: 200, data: [{ ...fixture, id: 'invalid' }] }));
      if (mode === '401' || mode === '403') return new Response('PRIVATE_TOKEN', { status: Number(mode) });
      throw new TypeError('PRIVATE_TOKEN', { cause: { code: mode === 'timeout' ? 'UND_ERR_CONNECT_TIMEOUT' : 'ECONNRESET' } });
    });
    await assert.rejects(fetchRf39Objects('PRIVATE_TOKEN'), error => {
      assert.doesNotMatch(JSON.stringify(error), /PRIVATE_TOKEN/);
      return true;
    });
    assert.equal(calls, mode === 'timeout' ? 2 : 1, mode);
  }
});
