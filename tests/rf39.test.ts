import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRf39Response, rf39Draft, rf39ImageUrl, rf39IsComplex, rf39LayoutDraft, rf39Number, rf39Summary } from '../server/utils/rf39-data';
import { fetchRf39Feed, fetchRf39Objects, parseRf39Feed, rf39FeedUrl, rf39ReadBody } from '../server/utils/rf39';

import { rf39Offer, rf39Xml, rf39Chunks } from './fixtures/rf39-feed';

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

test('RF39 maps a real response shape into a published elite apartment without private fields', () => {
  const item = parse();
  const draft = rf39Draft(item);
  assert.equal(draft.data.title, '3-к кв. 90.5 м²');
  assert.equal(draft.data.type, 'apartment');
  assert.equal(draft.data.housingMarket, 'secondary');
  assert.equal(rf39Draft({ ...item, type: 'Квартиры в новостройках' }).data.housingMarket, 'newbuild');
  assert.equal(draft.data.price, 9200000);
  assert.equal(draft.data.area, 90.5);
  assert.equal(draft.data.bedrooms, 3);
  assert.equal(draft.data.floors, 7); // Floor count, not the apartment's floor.
  assert.equal(draft.data.finish, 'Чистовая');
  assert.equal(draft.data.readiness, 'Уточняется');
  assert.equal(draft.data.description, 'Описание\nквартиры');
  assert.equal(draft.data.published, true);
  assert.equal(draft.data.featured, false);
  assert.equal(draft.data.elite, true);
  assert.equal(draft.data.sourceId, 'rf39:123');
  assert.equal(draft.data.slug, 'robj-123');
  assert.equal(rf39Summary(item).area, 90.5);
  assert.equal(rf39Summary(item).bedrooms, 3);
  assert.equal(rf39Summary(item).floors, 7);
  assert.deepEqual(draft.imageUrls, ['https://crm.rf39.ru/images/objects/123/photo.jpg']);
  assert.deepEqual(draft.planImageUrls, []);
  assert.equal(draft.imagesIncomplete, false);
  assert.equal(JSON.stringify([item, draft, rf39Summary(item)]).includes('PRIVATE_'), false);
});

test('RF39 distinguishes repeated URLs from invalid or truncated image sets', () => {
  const same = rf39Draft(parse({ ...fixture, images: [fixture.images[0], fixture.images[0]] }));
  assert.equal(same.imageUrls.length, 1);
  assert.equal(same.imagesIncomplete, false);
  const invalid = rf39Draft(parse({ ...fixture, images: [...fixture.images, 'https://evil.test/photo.jpg'] }));
  assert.equal(invalid.imageUrls.length, 1);
  assert.equal(invalid.imagesIncomplete, true);
  assert.ok(invalid.warnings.some(warning => warning.includes('отклонены')));
  const limited = rf39Draft(parse({ ...fixture, images: Array.from({ length: 101 }, (_, i) => `/images/objects/123/${i}.jpg`) }));
  assert.equal(limited.imageUrls.length, 100);
  assert.equal(limited.imagesIncomplete, true);
  assert.ok(limited.warnings.some(warning => warning.includes('первые 100')));
});

test('RF39 corpus remains a complex without borrowing characteristics from an arbitrary layout', () => {
  const item = parse({ ...fixture, type: 'Квартиры в новостройках',
    layouts: { 77: { id: 77, price: '100', params: fixture.params } },
    params: { 'built-year': { value: '2026 г.' }, 'ready-quarter': { value: '4' }, 'building-state': { value: 'строится' } },
    development: { title: 'ЖК', developer: { title: 'Застройщик' } },
  });
  const draft = rf39Draft(item);
  assert.equal(draft.data.type, 'complex');
  assert.equal(draft.data.housingMarket, null);
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
  assert.equal(draft.data.slug, 'robj-layout-17209-2775');
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
  assert.equal(draft.data.published, true);
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

test('XML uses trusted public IDs, skips houses and keeps only public fields', async () => {
  const result = await parseRf39Feed(rf39Chunks(rf39Xml(
    rf39Offer(14567, '<new-flat>да</new-flat><building-name>ЖК Тест</building-name><yandex-building-id>999</yandex-building-id><sales-agent><name>PRIVATE_NAME</name><phone>PRIVATE_PHONE</phone></sales-agent><image>https://rf39.ru/images/objects/14567/a.jpg</image>', 'Я21001803388АL12'),
    rf39Offer(2, '', 'J2', 'дом'), rf39Offer(3, '', 'J3', 'дача'),
  )));
  assert.deepEqual(result.presentIds, [14567, 2, 3]);
  assert.deepEqual(result.items.map(item => rf39Summary(item).supported), [true, false, false]);
  assert.equal(result.items[0]!.development?.title, 'ЖК Тест');
  assert.equal(result.items[0]!.development?.id, undefined);
  assert.equal(result.items[0]!.complex, undefined);
  assert.equal(result.authoritative, true);
  assert.equal(result.snapshotDate, '2026-11-03T14:23:00.000Z');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_NAME|PRIVATE_PHONE|sales-agent/);
  const draft = rf39Draft(result.items[0]!);
  assert.equal(draft.data.sourceId, 'rf39:14567');
  assert.equal(draft.data.elite, true);
  assert.equal(draft.data.published, true);
  assert.equal(draft.data.housingMarket, 'newbuild');
  assert.deepEqual(draft.imageUrls, ['https://rf39.ru/images/objects/14567/a.jpg']);
});

test('XML preserves invalid record IDs while independent records continue', async () => {
  const result = await parseRf39Feed(rf39Chunks(rf39Xml(
    rf39Offer(1, '<rooms>4</rooms>'), rf39Offer(2),
    rf39Offer(3).replace('https://rf39.ru/catalog/sale/vtorichka/object/3', 'https://evil.test/object/3'),
    rf39Offer(4, '<image>https://evil.test/private.jpg</image>'),
  )));
  assert.deepEqual(result.items.map(item => item.id), [2, 4]);
  assert.deepEqual(result.presentIds, [1, 2, 4]);
  assert.deepEqual(result.errors.map(error => error.id), [1, null, 4]);
  assert.equal(result.authoritative, false);
  assert.equal(result.items.find(item => item.id === 4)?.imagesIncomplete, true);
  assert.equal(rf39Draft(result.items.find(item => item.id === 4)!).imagesIncomplete, true);
});

test('XML retains incomplete galleries through drafts but repeated URLs at the limit remain complete', async () => {
  const photos = Array.from({ length: 100 }, (_, i) => `<image>https://rf39.ru/images/objects/123/${i}.jpg</image>`).join('');
  const extra = '<image>https://rf39.ru/images/objects/123/extra.jpg</image>';
  const repeated = '<image>https://rf39.ru/images/objects/123/0.jpg</image>';
  const snapshot = await parseRf39Feed(rf39Chunks(rf39Xml(
    rf39Offer(10, photos + extra), rf39Offer(11, photos + repeated),
    rf39Offer(12, repeated + '<image>https://evil.test/private.jpg</image>'),
  )));
  assert.deepEqual(snapshot.items.map(item => item.images?.length), [100, 100, 1]);
  assert.deepEqual(snapshot.items.map(item => item.imagesIncomplete), [true, false, true]);
  assert.deepEqual(snapshot.items.map(item => rf39Draft(item).imagesIncomplete), [true, false, true]);
  assert.deepEqual(snapshot.errors.map(error => error.id), [10, 12]);
});

test('XML rejects empty, truncated, duplicate, oversized and entity-bearing documents', async () => {
  for (const xml of ['', rf39Xml(), rf39Xml(rf39Offer(1)).slice(0, -5), rf39Xml(rf39Offer(1), rf39Offer(1)),
    rf39Xml(rf39Offer(1), rf39Offer(1, '', 'OTHER')), '<!DOCTYPE foo [<!ENTITY x "secret">]>' + rf39Xml(rf39Offer(1)),
    rf39Xml(rf39Offer(1, '<a><a><a><a><a><a><a><a><a>x</a></a></a></a></a></a></a></a></a>'))])
    await assert.rejects(parseRf39Feed(rf39Chunks(xml)));
  await assert.rejects(parseRf39Feed(rf39Chunks(rf39Xml(rf39Offer(1))), 20));
  for (const url of ['http://feed.rf39.ru/30.xml', 'https://evil.test/30.xml', 'https://feed.rf39.ru/30.xml?key=x', 'https://user@feed.rf39.ru/30.xml', 'https://feed.rf39.ru:443/30.xml'])
    assert.throws(() => rf39FeedUrl(url));
});

test('XML accepts CRM public object URLs while rejecting untrusted hosts and credentialed links', async () => {
  const links = [
    'https://crm.rf39.ru/catalog/sale/vtorichka/object/1',
    'https://rf39.ru/catalog/sale/vtorichka/object/2',
    'https://crm.rf39.ru.evil.test/catalog/sale/vtorichka/object/3',
    'https://user@crm.rf39.ru/catalog/sale/vtorichka/object/4',
  ];
  const xml = rf39Xml(...links.map((url, index) => rf39Offer(index + 1).replace(
    `https://rf39.ru/catalog/sale/vtorichka/object/${index + 1}`, url)));
  const snapshot = await parseRf39Feed((async function* () { yield Buffer.from(xml); })());
  assert.deepEqual(snapshot.presentIds, [1, 2]);
  assert.deepEqual(snapshot.items.map(item => item.id), [1, 2]);
  assert.equal(snapshot.errors.length, 2);
  assert.equal(snapshot.authoritative, false);
});

test('RF39 downloads complete XML once and filters numeric IDs locally', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls++;
    assert.equal(url, 'https://feed.rf39.ru/101.xml');
    assert.equal(options.body, undefined);
    assert.equal(options.redirect, 'error');
    return new Response(rf39Xml(rf39Offer(1), rf39Offer(2), rf39Offer(3)));
  });
  assert.deepEqual((await fetchRf39Objects('https://feed.rf39.ru/101.xml', 0, '1,3')).map(item => item.id), [1, 3]);
  assert.deepEqual((await fetchRf39Objects('https://feed.rf39.ru/101.xml', 1)).map(item => item.id), [2, 3]);
  assert.equal(calls, 1);
  for (const id of ['0', '-2', '1e3', '1,0', Array(101).fill('1').join(',')])
    await assert.rejects(fetchRf39Objects('https://feed.rf39.ru/101.xml', 0, id), { statusCode: 400 });
  assert.equal(calls, 1);
});

test('RF39 failures never leak upstream data or become an empty catalog', async t => {
  for (const mode of ['schema', '401', '403', 'network']) {
    t.mock.method(globalThis, 'fetch', async () => {
      if (mode === 'schema') return new Response('PRIVATE_CONTACT');
      if (mode !== 'network') return new Response('PRIVATE_CONTACT', { status: Number(mode) });
      throw new Error('PRIVATE_CONTACT');
    });
    await assert.rejects(fetchRf39Feed('https://feed.rf39.ru/102.xml', true), error => {
      assert.doesNotMatch(JSON.stringify(error), /PRIVATE_CONTACT/);
      return (error as any).statusCode === 502;
    });
  }
});
