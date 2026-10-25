import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createError } from 'h3';
import { db } from '../server/utils/db';
import { parseNmarketFeed } from '../server/utils/nmarket-data';
import { parseRf39Response } from '../server/utils/rf39-data';
import { cacheApartmentMatches, matchNmarketApartments, rf39ApartmentIdentity } from '../server/utils/apartment-matching';

test('duplicate import validates source choice, defaults to Nmarket and preserves chosen CRM aliases and existing edits', async () => {
  const xml = `<realty-feed xmlns="http://webmaster.yandex.ru/schemas/feed/realty/2010-06"><offer internal-id="99"><type>продажа</type><property-type>жилая</property-type><category>квартира</category>
    <nmarket-complex-id>7</nmarket-complex-id><nmarket-building-id>8</nmarket-building-id><building-name>ЖК Тест</building-name>
    <location><locality-name>Калининград</locality-name><address>Тестовая улица, 1</address><apartment>12</apartment></location>
    <rooms>2</rooms><floor>3</floor><area><value>55.4</value><unit>кв. м</unit></area><price><value>9000000</value><currency>RUR</currency></price>
    </offer></realty-feed>`;
  const rawCrm = { id: 100, type: 'Квартиры - вторичное жильё', deal_type: 'sale', title: 'Квартира из CRM', city: 'Калининград',
    address: 'Тестовая улица, 1', apartment: '12', complex: { id: 9 }, price: '9100000',
    params: { area: { value: '55.4' }, rooms: { value: '2' }, floor: { value: '3' } } };
  const crm = parseRf39Response({ code: 200, data: { 100: rawCrm } })[0]!;
  const nmarket = await parseNmarketFeed((async function* () { yield Buffer.from(xml); })());
  const matches = matchNmarketApartments(nmarket, [rf39ApartmentIdentity(crm)]);
  assert.equal(matches.get('rf39:100')?.id, 'apartment:99');
  const transaction = db.$transaction, fetch = globalThis.fetch, originalDir = process.env.UPLOAD_DIR;
  const globals = globalThis as any;
  const names = ['defineEventHandler', 'readBody', 'useRuntimeConfig', 'createError'];
  const originals = names.map(name => globals[name]);
  const dir = await mkdtemp(join(tmpdir(), 'newh-source-choice-'));
  process.env.UPLOAD_DIR = dir;
  let body: Record<string, unknown> = {};
  let properties: any[] = [], aliases: any[] = [];
  const tx = {
    $executeRaw: async () => {},
    property: {
      findUnique: async ({ where }: any) => where.id ? { type: 'complex' } : null,
      findMany: async ({ where }: any) => properties.filter(property => where.sourceId.in.includes(property.sourceId)),
      create: async ({ data }: any) => { const property = { ...data, id: 'draft' }; properties.push(property); return property; },
    },
    propertyImportSource: {
      findMany: async ({ where, include }: any) => aliases.filter(alias => where.sourceId ? where.sourceId.in.includes(alias.sourceId)
        : where.OR.some((condition: any) => condition.sourceId?.in.includes(alias.sourceId) || condition.apartmentKey?.in.includes(alias.apartmentKey)))
        .map(alias => include ? { ...alias, property: properties.find(property => property.id === alias.propertyId) } : alias),
      findUnique: async ({ where }: any) => aliases.find(alias => alias.sourceId === where.sourceId),
      upsert: async ({ where, create, update }: any) => {
        const alias = aliases.find(alias => alias.sourceId === where.sourceId);
        if (alias) Object.assign(alias, update); else aliases.push(create);
      },
    },
  };
  db.$transaction = (async (callback: any) => callback(tx)) as any;
  globals.defineEventHandler = (handler: unknown) => handler;
  globals.readBody = async () => body;
  globals.useRuntimeConfig = () => ({ rf39Token: 'fixture', nmarketFeedUrl: 'https://ecatalog-service.nmarket.pro/source-choice-test', nmarketSnapshotPath: '' });
  globals.createError = createError;
  globalThis.fetch = async url => String(url).includes('crm.rf39.ru')
    ? Response.json({ code: 200, data: { 100: rawCrm } }) : new Response(xml);
  try {
    const handler = (await import('../server/api/admin/rf39/import.post')).default;
    body = { id: 100, preferredSource: 'unknown' };
    await assert.rejects(handler({} as any), { statusCode: 400 });
    for (const preference of [undefined, 'rf39']) {
      properties = []; aliases = [];
      cacheApartmentMatches('complex', false, matches);
      body = { id: 100, complexId: 'complex', preferredNmarketId: 'apartment:99', ...(preference ? { preferredSource: preference } : {}) };
      assert.equal((await handler({} as any)).created, true);
      assert.equal(properties.length, 1);
      assert.equal(properties[0].sourceId, preference ? 'rf39:100' : 'nmarket:apartment:99');
      assert.equal(properties[0].price, preference ? 9100000 : 9000000);
      assert.equal(properties[0].published, false);
      assert.deepEqual(new Set(aliases.map(alias => alias.sourceId)), new Set(['rf39:100', 'nmarket:apartment:99']));
      assert.ok(aliases.every(alias => alias.apartmentKey === matches.get('rf39:100')!.key));
      properties[0].title = 'Ручная правка';
      body.preferredSource = preference ? 'nmarket' : 'rf39';
      assert.equal((await handler({} as any)).created, false);
      assert.equal(properties.length, 1);
      assert.equal(properties[0].title, 'Ручная правка');
    }
    properties = []; aliases = [];
    body = { id: 100, complexId: 'expired', preferredNmarketId: 'apartment:99', preferredSource: 'rf39' };
    await assert.rejects(handler({} as any), { statusCode: 409 });
    assert.equal(properties.length, 0);
  } finally {
    db.$transaction = transaction; globalThis.fetch = fetch;
    names.forEach((name, index) => { if (originals[index] === undefined) delete globals[name]; else globals[name] = originals[index]; });
    if (originalDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = originalDir;
    await rmdir(dir);
  }
});
