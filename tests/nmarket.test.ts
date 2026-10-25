import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, utimes, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nmarketDraft, nmarketImageUrl, nmarketSummary, parseNmarketFeed } from '../server/utils/nmarket-data';
import { fetchNmarketObjects, fetchNmarketSnapshot, nmarketFeedUrl } from '../server/utils/nmarket';

const image = (key: string, tag = '') => `<image${tag ? ` tag="${tag}"` : ''}>http://img.nmarket.pro/photo/pid/${key}/?v=1&amp;hash=PRIVATE_IMAGE_KEY</image>`;
const photo = '12345678-1234-1234-1234-123456789012';
const plan = '12345678-1234-1234-1234-123456789013';
function offer(id = '123', overrides: Record<string, string> = {}) {
  const fields = {
    type: 'продажа', 'property-type': 'жилая', category: 'квартира',
    description: 'Квартира в ЖК. Застройщик: Строитель.\nОписание квартиры.',
    'complex-description': '&lt;p&gt;Описание &amp; территория&lt;/p&gt;',
    'nmarket-complex-id': '456', 'building-name': 'Тестовый ЖК',
    rooms: '2', 'floors-total': '10', floor: '3', 'built-year': '2027', 'ready-quarter': '4',
    'building-state': 'unfinished', renovation: 'Чистовая отделка',
    location: '<locality-name>Калининград</locality-name><address>Улица, 1</address><latitude>54.7</latitude><longitude>20.3</longitude>',
    price: '<value>9200000</value><currency>RUR</currency>', area: '<value>58.5</value><unit>кв. м</unit>',
    'sales-agent': '<phone>PRIVATE_PHONE</phone><email>PRIVATE_EMAIL</email><category>agency</category>',
    ...overrides,
  };
  return `<offer internal-id="${id}">${Object.entries(fields).map(([key, value]) => `<${key}>${value}</${key}>`).join('')}${image(plan, 'plan')}${image(photo, 'housemain')}</offer>`;
}
const feed = (offers = offer()) => `<?xml version="1.0" encoding="utf-8"?><realty-feed xmlns="http://webmaster.yandex.ru/schemas/feed/realty/2010-06">${offers}</realty-feed>`;
async function* chunks(xml: string, split = 31) {
  const bytes = Buffer.from(xml);
  for (let offset = 0; offset < bytes.length; offset += split) yield bytes.subarray(offset, offset + split);
}
const parse = (xml = feed()) => parseNmarketFeed(chunks(xml));

test('NMarket streams UTF-8 XML into filled drafts and strips agent/private fields from list/card data', async () => {
  const objects = await parse();
  const item = objects.find(item => item.id === 'apartment:123')!;
  const draft = nmarketDraft(item);
  assert.equal(draft.data.type, 'apartment');
  assert.equal(draft.data.title, '2-к кв. 58.5 м²');
  assert.equal(nmarketDraft({ ...item, title: 'Старое длинное название · Тестовый ЖК' }).data.title, '2-к кв. 58.5 м²');
  assert.equal(draft.data.price, 9200000);
  assert.equal(draft.data.area, 58.5);
  assert.equal(draft.data.bedrooms, 2);
  assert.equal(draft.data.floors, 10);
  assert.equal(draft.data.latitude, 54.7);
  assert.equal(draft.data.longitude, 20.3);
  assert.equal(draft.data.developer, 'Строитель');
  assert.equal(draft.data.readiness, 'IV кв. 2027');
  assert.equal(draft.data.completionDate, '2027-12-31');
  assert.equal(draft.data.sourceId, 'nmarket:apartment:123');
  assert.equal(draft.data.published, false);
  assert.equal(draft.data.featured, false);
  assert.equal(draft.data.priceKind, null);
  assert.equal(draft.imageUrls.length, 2);
  assert.ok(draft.imageUrls[0]!.includes(plan));
  assert.ok(draft.imageUrls[1]!.includes(photo));
  assert.ok(draft.imageUrls.every(url => url.startsWith('https://img.nmarket.pro/')));
  assert.deepEqual(draft.planImageUrls, draft.imageUrls.filter(url => url.includes(plan)));
  assert.equal(draft.data.nmarketComplexId, '456');
  assert.equal(JSON.stringify([nmarketSummary(item), draft.data]).includes('PRIVATE_'), false);
  assert.equal(JSON.stringify(objects).includes('PRIVATE_PHONE'), false);
  assert.equal(JSON.stringify(objects).includes('PRIVATE_EMAIL'), false);
});

test('NMarket groups a complex across all offers with minimum price and latest completion, excluding apartment plans', async () => {
  const objects = await parse(feed(offer() + offer('124', {
    price: '<value>8000000</value><currency>RUB</currency>', area: '<value>24</value><unit>кв. м</unit>',
    studio: '1', 'built-year': '2028', 'ready-quarter': '1', renovation: 'Черновая отделка',
  })));
  const complex = objects.find(item => item.id === 'complex:456')!;
  const draft = nmarketDraft(complex);
  assert.equal(objects.length, 3);
  assert.equal(complex.offerCount, 2);
  assert.equal(draft.data.price, 8000000);
  assert.equal(draft.data.priceKind, 'from');
  assert.equal(draft.data.area, null);
  assert.equal(draft.data.bedrooms, null);
  assert.equal(draft.data.completionDate, '2028-03-31');
  assert.equal(draft.data.finish, 'Зависит от квартиры');
  assert.equal(draft.data.description, 'Описание & территория');
  assert.equal(draft.imageUrls.length, 1);
  assert.ok(draft.imageUrls[0]!.includes(photo));
  assert.deepEqual(draft.planImageUrls, []);
  assert.match(draft.warnings.join(' '), /Отдельные квартиры не создавались/);
  assert.equal(objects.find(item => item.id === 'apartment:124')!.bedrooms, 0);
});

test('NMarket retains an explicit plan tag when a URL is repeated earlier as a general image', async () => {
  const objects = await parse(feed().replace(image(plan, 'plan'), image(plan, 'housemain') + image(plan, 'floorplan')));
  const draft = nmarketDraft(objects.find(item => item.id === 'apartment:123')!);
  assert.equal(draft.imageUrls.length, 2);
  assert.equal(draft.planImageUrls.length, 1);
  assert.ok(draft.planImageUrls[0]!.includes(plan));
  assert.equal(draft.imageUrls[0], draft.planImageUrls[0]);
  assert.deepEqual(nmarketDraft(objects.find(item => item.type === 'complex')!).planImageUrls, []);
});

test('NMarket excludes a plan from the complex even when another offer labels its URL as a photo', async () => {
  const objects = await parse(feed(offer().replace(image(plan, 'plan'), image(plan, 'housemain')) + offer('124')));
  const complex = objects.find(item => item.type === 'complex')!;
  assert.ok(complex.images.every(image => !image.url.includes(plan)));
  assert.deepEqual(nmarketDraft(complex).imageUrls, [nmarketImageUrl(`http://img.nmarket.pro/photo/pid/${photo}/?v=1&hash=PRIVATE_IMAGE_KEY`)]);
});

test('NMarket drafts put plans before photos and remove all plans from old complex snapshots', async () => {
  const item = (await parse()).find(item => item.type === 'apartment')!;
  const photos = item.images.filter(image => !image.plan);
  const plans = item.images.filter(image => image.plan);
  const oldSnapshot = { ...item, images: [...photos, ...plans] };
  const apartment = nmarketDraft(oldSnapshot);
  assert.deepEqual(apartment.imageUrls, [...plans, ...photos].map(image => image.url));
  assert.deepEqual(apartment.planImageUrls, plans.map(image => image.url));
  const complex = nmarketDraft({ ...oldSnapshot, type: 'complex', id: 'complex:456' });
  assert.deepEqual(complex.imageUrls, photos.map(image => image.url));
  assert.deepEqual(complex.planImageUrls, []);
});

test('NMarket does not invent missing values or mix currencies/units; unsupported offers cannot import', async () => {
  const objects = await parse(feed(offer() + offer('124', {
    price: '<value>70000</value><currency>EUR</currency>', rooms: 'unknown', 'floors-total': '-1',
    area: '<value>45</value><unit>sqft</unit>',
    location: '<locality-name>Калининград</locality-name><latitude>100</latitude><longitude>20.3</longitude>',
  }) + offer('125', { type: 'аренда' })));
  const invalid = objects.find(item => item.id === 'apartment:124')!;
  for (const key of ['price', 'area', 'bedrooms', 'floors', 'latitude', 'longitude'] as const) assert.equal(invalid[key], null);
  assert.equal(objects.find(item => item.type === 'complex')!.price, null);
  assert.equal(objects.find(item => item.type === 'complex')!.offerCount, 2);
  const rental = objects.find(item => item.id === 'apartment:125')!;
  assert.equal(nmarketSummary(rental).supported, false);
  assert.throws(() => nmarketDraft(rental), /продажа/);
});

test('NMarket rejects malformed/truncated feeds, DTD, duplicate IDs/fields and bounded bodies', async () => {
  for (const xml of ['', '<html>login</html>', feed().slice(0, -15), feed(offer() + offer()),
    feed().replace('<rooms>2</rooms>', '<rooms>2</rooms><rooms>3</rooms>'),
    feed().replace('<?xml version="1.0" encoding="utf-8"?>', '<!DOCTYPE realty-feed [<!ENTITY private SYSTEM "file:///etc/passwd">]>')]) {
    await assert.rejects(parse(xml));
  }
  await assert.rejects(parseNmarketFeed(chunks(feed()), 100), /too large/);
  assert.deepEqual(await parse(feed('')), []);
});

test('NMarket restricts source and image fetches to the observed service hosts', () => {
  assert.equal(nmarketFeedUrl('https://ecatalog-service.nmarket.pro/export?key=secret'), 'https://ecatalog-service.nmarket.pro/export?key=secret');
  for (const url of ['http://ecatalog-service.nmarket.pro/export', 'https://evil.test/a', 'https://ecatalog-service.nmarket.pro.evil.test/a',
    'https://user:secret@ecatalog-service.nmarket.pro/a', 'https://ecatalog-service.nmarket.pro:444/a', 'file:///etc/passwd']) assert.throws(() => nmarketFeedUrl(url));
  for (const url of ['https://evil.test/photo/pid/' + photo + '/', 'http://127.0.0.1/a', 'https://img.nmarket.pro/private',
    'https://u:p@img.nmarket.pro/photo/pid/' + photo + '/', 'https://img.nmarket.pro/photo/pid/' + photo + '/#secret']) assert.equal(nmarketImageUrl(url), null);
  assert.equal(nmarketImageUrl('http://img.nmarket.pro/photo/pid/' + photo + '/?v=1'), 'https://img.nmarket.pro/photo/pid/' + photo + '/?v=1');
});

test('NMarket shares one bounded snapshot for concurrent lists/imports, rejects redirects and hides source credentials', async t => {
  let calls = 0;
  let options: RequestInit | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    calls++; options = init;
    return new Response(feed());
  });
  const source = 'https://ecatalog-service.nmarket.pro/test?key=SECRET_TEST_TOKEN';
  const [first, second] = await Promise.all([fetchNmarketObjects(source), fetchNmarketObjects(source)]);
  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.equal(await fetchNmarketObjects(source), first);
  assert.equal(calls, 1);
  assert.equal(options?.redirect, 'error');
  assert.ok(options?.signal instanceof AbortSignal);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('SECRET_TEST_TOKEN PRIVATE_EMAIL'); });
  await assert.rejects(fetchNmarketObjects(source + '_new'), error => {
    assert.equal(JSON.stringify(error).includes('SECRET_TEST_TOKEN'), false);
    return true;
  });
  t.mock.method(globalThis, 'fetch', async () => new Response(feed()));
  assert.equal((await fetchNmarketObjects(source + '_new')).length, 2);
});

test('NMarket explicitly reads saved XML without network, keeps its generation date, and invalidates cache after replacement', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'nmarket-test-'));
  const file = join(dir, 'snapshot.xml');
  t.after(async () => { await unlink(file).catch(() => {}); await rmdir(dir); });
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Saved mode must not fetch a feed'); });
  await writeFile(file, feed('<generation-date>2026-10-19T16:05:08+03:00</generation-date>' + offer()));
  await utimes(file, new Date('2020-01-01Z'), new Date('2020-01-01Z'));
  const first = await fetchNmarketSnapshot(file);
  assert.equal(first.snapshotDate, '2026-10-19T13:05:08.000Z');
  assert.equal(await fetchNmarketSnapshot(file), first);
  const draft = nmarketDraft(first.items.find(item => item.id === 'apartment:123')!, first.snapshotDate);
  assert.equal(draft.data.sourceFetchedAt.toISOString(), first.snapshotDate);
  assert.equal(draft.data.published, false);
  assert.match(draft.warnings.join(' '), /Сохранённая выгрузка от 2026-10-19/);
  await writeFile(file, feed(offer('999')));
  const modified = new Date('2026-10-20T10:00:00.000Z');
  await utimes(file, modified, modified);
  const second = await fetchNmarketSnapshot(file);
  assert.notEqual(second, first);
  assert.equal(second.snapshotDate, modified.toISOString());
  assert.ok(second.items.some(item => item.id === 'apartment:999'));
});

test('NMarket saved mode rejects missing/corrupt files without falling back to the live source or leaking paths', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'nmarket-test-'));
  const file = join(dir, 'snapshot.xml');
  t.after(async () => { await unlink(file).catch(() => {}); await rmdir(dir); });
  t.mock.method(globalThis, 'fetch', () => { throw new Error('No silent network fallback'); });
  await assert.rejects(fetchNmarketSnapshot(file), error => {
    assert.equal((error as { statusCode: number }).statusCode, 503);
    assert.equal(JSON.stringify(error).includes(file), false);
    return true;
  });
  await writeFile(file, feed().slice(0, -30));
  await assert.rejects(fetchNmarketSnapshot(file), error => {
    assert.equal((error as { statusCode: number }).statusCode, 502);
    assert.equal(JSON.stringify(error).includes(file), false);
    return true;
  });
});

test('NMarket replaces saved XML after a complete validated download and explicit refresh bypasses the live cache', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'nmarket-test-'));
  const path = join(dir, 'snapshot.xml');
  t.after(async () => { await unlink(path).catch(() => {}); await rmdir(dir); });
  const source = 'https://ecatalog-service.nmarket.pro/test-refresh';
  await writeFile(path, feed(offer('1')));
  const old = await fetchNmarketSnapshot(path);
  const xml = feed('<generation-date>2026-10-25T12:00:00+03:00</generation-date>' + offer('2'));
  let complete!: () => void, started!: () => void, calls = 0;
  const gate = new Promise<void>(resolve => { complete = resolve; });
  const beginning = new Promise<void>(resolve => { started = resolve; });
  t.mock.method(globalThis, 'fetch', async () => { calls++; started(); await gate; return new Response(xml); });
  const first = fetchNmarketObjects(source, path, true);
  await beginning;
  const second = fetchNmarketObjects(source, path, true);
  assert.equal(await fetchNmarketSnapshot(path), old);
  complete();
  assert.equal((await Promise.all([first, second]))[0], await fetchNmarketObjects(source, path));
  assert.equal(calls, 1);
  assert.equal(await readFile(path, 'utf8'), xml);
  const saved = await fetchNmarketSnapshot(path);
  assert.equal(saved.snapshotDate, '2026-10-25T09:00:00.000Z');
  assert.ok(saved.items.some(item => item.id === 'apartment:2'));
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(feed(offer('3'))); });
  await fetchNmarketObjects(source, path, true);
  assert.equal(calls, 2);
  assert.ok((await fetchNmarketSnapshot(path)).items.some(item => item.id === 'apartment:3'));
  assert.deepEqual(await readdir(dir), ['snapshot.xml']);
});

test('NMarket failed downloads leave saved XML and live cache intact and remove incomplete temporary files', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'nmarket-test-'));
  const path = join(dir, 'snapshot.xml');
  t.after(async () => { await unlink(path).catch(() => {}); await rmdir(dir); });
  const source = 'https://ecatalog-service.nmarket.pro/test-failed-refresh?key=PRIVATE_TOKEN';
  t.mock.method(globalThis, 'fetch', async () => new Response(feed()));
  const first = await fetchNmarketObjects(source, path);
  const bytes = await readFile(path);
  const snapshot = await fetchNmarketSnapshot(path);
  for (const result of [() => { throw new Error('PRIVATE_TOKEN'); },
    () => new Response(feed(offer('2')).slice(0, -10)),
    () => new Response('<html>PRIVATE_TOKEN</html>')]) {
    t.mock.method(globalThis, 'fetch', async () => result());
    await assert.rejects(fetchNmarketObjects(source, path, true), error => {
      assert.equal((error as { statusCode: number }).statusCode, 502);
      assert.doesNotMatch(JSON.stringify(error), /PRIVATE_TOKEN|snapshot\.xml/);
      return true;
    });
    assert.deepEqual(await readFile(path), bytes);
    assert.equal(await fetchNmarketSnapshot(path), snapshot);
    assert.equal(await fetchNmarketObjects(source, path), first);
    assert.deepEqual(await readdir(dir), ['snapshot.xml']);
  }
});
