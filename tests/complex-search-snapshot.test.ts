import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createError } from 'h3';
import { db } from '../server/utils/db';
import { DEFAULT_RF39_FEED_URL } from '../server/utils/rf39';
import { findComplexApartments } from '../server/utils/find-complex-apartments';
import { rf39Offer, rf39Xml } from './fixtures/rf39-feed';

test('saved CRM apartment search derives relations locally and preserves development and building boundaries', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'newh-saved-search-'));
  const crmPath = join(dir, 'crm.json'), nmarketPath = join(dir, 'nmarket.xml');
  const snapshotDate = '2026-10-19T10:00:00.000Z';
  const base = { type: 'Квартиры в новостройках', deal_type: 'sale', city: 'Калининград', address: 'Тестовая улица, 1',
    development: { id: 7, title: 'ЖК Тест' }, complex: { id: 9 } };
  await writeFile(crmPath, JSON.stringify({ version: 2, sourceHash: createHash('sha256').update(DEFAULT_RF39_FEED_URL).digest('hex'), snapshotDate, presentIds: [1, 100, 101, 200], errors: [], authoritative: true, items: [
    { ...base, id: 1, title: 'ЖК Тест Дом 1', layouts: [{ id: 20, apartment: '12', params: { area: { value: '55' } } }] },
    { ...base, id: 100, title: 'Квартира', apartment: '13', params: { area: { value: '40' } } },
    { ...base, id: 101, title: 'Квартира', apartment: '14', complex: { id: 10 }, params: { area: { value: '42' } } },
    { ...base, id: 200, title: 'Квартира', apartment: '15', development: { id: 99, title: 'Другой ЖК' }, params: { area: { value: '43' } } },
  ] }));
  await writeFile(nmarketPath, `<realty-feed xmlns="http://webmaster.yandex.ru/schemas/feed/realty/2010-06"><offer internal-id="999">
    <type>продажа</type><property-type>жилая</property-type><category>квартира</category><nmarket-complex-id>99</nmarket-complex-id>
    <building-name>Другой ЖК</building-name><location><locality-name>Светлогорск</locality-name><address>Другая улица, 2</address></location>
    <area><value>50</value><unit>кв. м</unit></area><price><value>10000000</value><currency>RUR</currency></price></offer></realty-feed>`);
  const initial = { id: 'saved-complex', type: 'complex', title: 'ЖК Тест', location: 'Калининград', address: '', sourceId: null };
  let target: any = { ...initial };
  const globals = globalThis as any;
  const replacements = { defineEventHandler: (handler: unknown) => handler, readBody: async () => ({ source: 'rf39', snapshot: 'saved' }),
    getRouterParam: () => initial.id, createError, db,
    useRuntimeConfig: () => ({ rf39FeedUrl: DEFAULT_RF39_FEED_URL, rf39SnapshotPath: crmPath, nmarketSnapshotPath: nmarketPath, nmarketFeedUrl: '' }) };
  const originals = Object.keys(replacements).map(name => [name, globals[name]] as const);
  Object.assign(globals, replacements);
  const tx = { $executeRaw: async () => {}, property: { findUnique: async () => target, findMany: async () => [],
    update: async ({ data }: any) => Object.assign(target, data) }, propertyImportSource: { findMany: async () => [] } };
  const findUnique = db.property.findUnique, transaction = db.$transaction;
  db.property.findUnique = (async () => target) as any;
  db.$transaction = (async (callback: any) => callback(tx)) as any;
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('Saved search must not request developments or objects'); });
  try {
    const handler = async (_event: unknown) => findComplexApartments(replacements.useRuntimeConfig(), initial.id, { source: 'rf39', snapshot: 'saved' });
    const whole = await handler({} as any);
    assert.deepEqual(whole.candidates, [{ id: 1, layoutId: 20 }, { id: 100 }, { id: 101 }]);
    assert.equal(whole.snapshotDate, snapshotDate);
    assert.equal(target.rf39ComplexId, '7');
    target = { ...initial, sourceId: 'rf39:1', title: 'ЖК Тест Дом 1' };
    const building = await handler({} as any);
    assert.deepEqual(building.candidates, [{ id: 1, layoutId: 20 }, { id: 100 }]);
    assert.equal(target.rf39BuildingId, '9');
    target = { ...initial, location: 'Светлогорск' };
    assert.deepEqual((await handler({} as any)).candidates, []);
    await unlink(crmPath);
    await assert.rejects(handler({} as any), { statusCode: 503 });
    assert.equal(requests, 0);
  } finally {
    db.property.findUnique = findUnique; db.$transaction = transaction;
    for (const [name, value] of originals) { if (value === undefined) delete globals[name]; else globals[name] = value; }
    await Promise.all([crmPath, nmarketPath].map(path => unlink(path).catch(() => {})));
    await rmdir(dir);
  }
});

test('XML apartment search uses exact name or house address without inventing CRM IDs or requiring Nmarket', async t => {
  const initial = { id: 'xml-complex', type: 'complex', title: 'ЖК Тест', location: 'Калининград', address: '', sourceId: null };
  let target: any = { ...initial };
  const previousFind = db.property.findUnique, previousTransaction = db.$transaction;
  t.after(() => { db.property.findUnique = previousFind; db.$transaction = previousTransaction; });
  db.property.findUnique = (async () => target) as any;
  db.$transaction = (async (callback: any) => callback({
    $executeRaw: async () => {}, property: { findMany: async () => [] }, propertyImportSource: { findMany: async () => [] },
  })) as any;
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    requests++;
    assert.equal(String(url), 'https://feed.rf39.ru/302.xml');
    return new Response(rf39Xml(
      rf39Offer(1, '<new-flat>да</new-flat><building-name>ЖК Тест</building-name>'),
      rf39Offer(2, '<new-flat>да</new-flat><building-name>ЖК Тест</building-name>').replace('Тестовая улица, 1', 'Тестовая улица, 2'),
      rf39Offer(3, '<new-flat>да</new-flat><building-name>Другой ЖК</building-name>').replace('Тестовая улица, 1', 'Другая улица, 3'),
    ));
  });
  const config = { rf39FeedUrl: 'https://feed.rf39.ru/302.xml', rf39SnapshotPath: '', nmarketFeedUrl: '', nmarketSnapshotPath: '' };
  assert.deepEqual((await findComplexApartments(config, initial.id, { source: 'rf39' })).candidates, [{ id: 1 }, { id: 2 }]);
  target = { ...initial, title: 'ЖК Тест Дом 1', address: 'Тестовая улица, 1', sourceId: 'rf39:999' };
  assert.deepEqual((await findComplexApartments(config, initial.id, { source: 'rf39' })).candidates, [{ id: 1 }]);
  assert.equal(target.rf39ComplexId, undefined);
  assert.equal(target.rf39BuildingId, undefined);
  target = { ...initial, location: 'Светлогорск' };
  assert.deepEqual((await findComplexApartments(config, initial.id, { source: 'rf39' })).candidates, []);
  assert.equal(requests, 1);
});
