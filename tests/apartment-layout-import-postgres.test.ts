import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { nmarketDraft, parseNmarketFeed } from '../server/utils/nmarket-data';

const databaseUrl = process.env.RF39_TEST_DATABASE_URL;

test('PostgreSQL imports one apartment per full layout set with minimum price and available floors', { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl!);
  const baseSchema = url.searchParams.get('schema') || '';
  assert.match(baseSchema, /^rf39_test_[a-z0-9_]+$/, 'Use a new rf39_test_* schema; application schemas are forbidden.');
  const schema = `${baseSchema}_layouts`;
  assert.ok(schema.length <= 63);
  url.searchParams.set('schema', schema);
  url.searchParams.set('connection_limit', '4');
  const isolatedUrl = url.href, setup = new PrismaClient({ datasourceUrl: isolatedUrl });
  const previousUrl = process.env.DATABASE_URL, previousDir = process.env.UPLOAD_DIR, previousFetch = globalThis.fetch;
  const dir = await mkdtemp(join(tmpdir(), 'apartment-layout-postgres-'));
  let created = false, client: PrismaClient | undefined;
  t.after(async () => {
    globalThis.fetch = previousFetch;
    await client?.$disconnect();
    if (created) await setup.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await setup.$disconnect();
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
    if (previousDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  });
  await setup.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  created = true;
  await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url)), 'migrate', 'deploy',
    '--schema', fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)),
  ], { env: { ...process.env, DATABASE_URL: isolatedUrl }, timeout: 120000 });
  process.env.DATABASE_URL = isolatedUrl;
  process.env.UPLOAD_DIR = dir;
  const { db } = await import('../server/utils/db');
  client = db;
  const { importProperty } = await import('../server/utils/import-property');
  const red = await sharp({ create: { width: 24, height: 16, channels: 3, background: '#bb4411' } }).png().toBuffer();
  const blue = await sharp({ create: { width: 24, height: 16, channels: 3, background: '#1144bb' } }).png().toBuffer();
  const common = await sharp({ create: { width: 24, height: 16, channels: 3, background: '#777777' } }).png().toBuffer();
  const media = new Map<string, Buffer>();
  function image(bytes: Buffer) { const url = `https://img.nmarket.pro/photo/pid/${randomUUID()}/`; media.set(url, bytes); return url; }
  const redUrl = image(red), redCopy = image(await sharp(red).withMetadata().png().toBuffer());
  const blueUrl = image(blue), commonUrl = image(common);
  let requests = 0, nextId = 1000;
  globalThis.fetch = async input => {
    requests++;
    const bytes = media.get(String(input));
    return bytes ? new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/png' } }) : new Response('missing', { status: 404 });
  };
  async function draft(externalId: string | null, price: number, floor: number, plans: string[]) {
    const xml = `<realty-feed xmlns="http://webmaster.yandex.ru/schemas/feed/realty/2010-06"><offer internal-id="${nextId++}">
      <type>продажа</type><property-type>жилая</property-type><category>квартира</category>
      ${externalId ? `<nmarket-complex-id>${externalId}</nmarket-complex-id>` : ''}<building-name>Тестовый ЖК</building-name>
      <location><locality-name>Калининград</locality-name><address>Тестовая, 1</address></location><studio>1</studio>
      <area><value>27.9</value><unit>кв. м</unit></area><price><value>${price}</value><currency>RUR</currency></price>
      <floor>${floor}</floor><floors-total>20</floors-total>${plans.map(url => `<image tag="plan">${url}</image>`).join('')}
      </offer></realty-feed>`;
    const items = await parseNmarketFeed((async function* () { yield Buffer.from(xml); })());
    return nmarketDraft(items.find(item => item.type === 'apartment')!);
  }
  async function complex() {
    return db.property.create({ data: { title: 'Тестовый ЖК', slug: randomUUID(), type: 'complex', location: 'Калининград',
      readiness: 'Готов', finish: 'Уточняется', description: '', utilities: [] } });
  }

  await t.test('groups offers into the oldest card, backfills its hash, preserves edits and remembers all source aliases', async () => {
    const parent = await complex();
    const firstDraft = await draft('71', 5_200_000, 2, [redUrl]);
    const first = await importProperty(firstDraft, parent.id);
    const before = await db.property.update({ where: { id: first.id }, data: { layoutHash: null, title: 'Ручное название',
      description: 'Ручное описание', finish: 'Ручная отделка', slug: 'manual-layout-card', published: true } });
    const secondDraft = await draft('71', 4_882_500, 5, [redCopy]);
    const second = await importProperty(secondDraft, parent.id);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.id, first.id);
    assert.equal(await db.property.count({ where: { complexId: parent.id } }), 1);
    const card = await db.property.findUniqueOrThrow({ where: { id: first.id }, include: { images: true, importSources: true } });
    assert.equal(card.price, 4_882_500);
    assert.equal(card.priceKind, 'from');
    assert.deepEqual(card.availableFloors, [2, 5]);
    assert.equal(card.floors, 20);
    for (const key of ['title', 'description', 'finish', 'slug', 'published'] as const) assert.equal(card[key], before[key]);
    assert.equal(card.images.length, 1);
    assert.ok(card.layoutHash);
    assert.deepEqual(new Set(card.importSources.map(source => source.sourceId)), new Set([firstDraft.data.sourceId, secondDraft.data.sourceId]));
    const previousRequests = requests;
    assert.equal((await importProperty(secondDraft, parent.id)).id, first.id);
    assert.equal(requests, previousRequests, 'Saved offer aliases do not download their plans again.');
  });

  await t.test('different complete sets, different complexes, unknown addresses and missing plans stay separate', async () => {
    const parent = await complex(), other = await complex();
    const a = await importProperty(await draft('72', 5_000_000, 3, [commonUrl, redUrl]), parent.id);
    const b = await importProperty(await draft('72', 5_000_000, 4, [commonUrl, blueUrl]), parent.id);
    assert.notEqual(a.id, b.id, 'One shared floor diagram is not enough.');
    const sameButElsewhere = await importProperty(await draft('72', 5_000_000, 4, [commonUrl, redUrl]), other.id);
    assert.notEqual(a.id, sameButElsewhere.id, 'An assigned local complex cannot be overridden by external IDs.');
    const complete = await importProperty(await draft('72', 5_000_000, 4, [redUrl]), parent.id);
    const incomplete = await importProperty(await draft('72', 5_000_000, 5,
      [redUrl, `https://img.nmarket.pro/photo/pid/${randomUUID()}/`]), parent.id);
    assert.notEqual(complete.id, incomplete.id, 'A failed plan download must not turn a partial set into a match.');
    assert.ok(incomplete.warnings.some(warning => warning.includes('пропущена')));
    const noPlans = await Promise.all([importProperty(await draft('72', 5_000_000, 2, []), parent.id),
      importProperty(await draft('72', 5_000_000, 3, []), parent.id)]);
    assert.notEqual(noPlans[0]!.id, noPlans[1]!.id);
    const unknown = await Promise.all([draft(null, 5_000_000, 2, [redUrl]), draft(null, 5_000_000, 3, [redUrl])]);
    for (const value of unknown) value.data.address = 'Тестовая';
    const noScope = await Promise.all(unknown.map(value => importProperty(value)));
    assert.notEqual(noScope[0]!.id, noScope[1]!.id);
    const external = await Promise.all([importProperty(await draft('73', 5_000_000, 2, [redUrl])),
      importProperty(await draft('74', 5_000_000, 3, [redUrl]))]);
    assert.notEqual(external[0]!.id, external[1]!.id);
  });

  await t.test('grouped imports append every unique floor diagram while preserving the unit plan and gallery edits', async () => {
    const parent = await complex();
    async function withFloor(floor: number, floorUrl: string) {
      const value = await draft('76', 5_000_000 - floor * 1000, floor, [redUrl, floorUrl]);
      value.unitPlanImageUrls = [redUrl];
      value.floorPlanImageUrls = [floorUrl];
      return value;
    }
    const first = await importProperty(await withFloor(2, commonUrl), parent.id);
    const original = await db.propertyImage.findMany({ where: { propertyId: first.id }, orderBy: { order: 'asc' } });
    await db.propertyImage.update({ where: { id: original[0]!.id }, data: { alt: 'Ручная подпись', hueShift: 17 } });
    const next = await importProperty(await withFloor(5, blueUrl), parent.id);
    assert.equal(next.id, first.id);
    assert.equal((await importProperty(await withFloor(6, image(await sharp(blue).withMetadata().png().toBuffer())), parent.id)).id, first.id);
    const card = await db.property.findUniqueOrThrow({ where: { id: first.id }, include: { images: { orderBy: { order: 'asc' } } } });
    assert.equal(card.images.length, 3);
    assert.deepEqual(card.images.map(value => value.planRole), ['unit', 'floor', 'floor']);
    assert.deepEqual(card.images.map(value => value.order), [0, 1, 2]);
    assert.equal(card.images[0]!.id, original[0]!.id);
    assert.equal(card.images[0]!.alt, 'Ручная подпись');
    assert.equal(card.images[0]!.hueShift, 17);
    assert.equal(card.images[1]!.id, original[1]!.id);
    assert.deepEqual(card.availableFloors, [2, 5, 6]);
    assert.equal(card.price, 4_994_000);
  });

  await t.test('unlinked newbuilds without external IDs group at the same numbered address', async () => {
    const drafts = await Promise.all([draft(null, 5_200_000, 5, [redUrl]), draft(null, 4_882_500, 2, [redCopy])]);
    drafts[1]!.data.location = 'г. Калининград';
    drafts[1]!.data.address = 'тестовая 1';
    const results = await Promise.all(drafts.map(value => importProperty(value)));
    assert.equal(results[0]!.id, results[1]!.id);
    const card = await db.property.findUniqueOrThrow({ where: { id: results[0]!.id } });
    assert.equal(card.complexId, null);
    assert.equal(card.price, 4_882_500);
    assert.deepEqual(card.availableFloors, [2, 5]);
    const elsewhere = await draft(null, 5_000_000, 3, [redUrl]);
    elsewhere.data.address = 'Тестовая, 2';
    assert.notEqual((await importProperty(elsewhere)).id, card.id);
  });

  await t.test('a full gallery rejects a new floor diagram without losing the incoming offer or changing the keeper', async () => {
    const parent = await complex();
    const initial = await draft('77', 5_000_000, 2, [redUrl]);
    const first = await importProperty(initial, parent.id);
    await db.propertyImage.createMany({ data: Array.from({ length: 99 }, (_, index) => ({ propertyId: first.id,
      file: `/uploads/manual-${index}.webp`, alt: 'Ручное фото', order: index + 1 })) });
    const incoming = await draft('77', 4_000_000, 3, [redUrl, blueUrl]);
    incoming.unitPlanImageUrls = [redUrl];
    incoming.floorPlanImageUrls = [blueUrl];
    await assert.rejects(importProperty(incoming, parent.id), { statusCode: 409 });
    const unchanged = await db.property.findUniqueOrThrow({ where: { id: first.id }, include: { images: true, importSources: true } });
    assert.equal(unchanged.price, 5_000_000);
    assert.deepEqual(unchanged.availableFloors, [2]);
    assert.equal(unchanged.images.length, 100);
    assert.deepEqual(unchanged.importSources.map(value => value.sourceId), [initial.data.sourceId]);
  });

  await t.test('an unavailable old floor diagram keeps its row and reports a warning while new floor diagrams are added', async () => {
    const parent = await complex();
    const first = await importProperty(await draft('78', 5_000_000, 2, [redUrl]), parent.id);
    const manual = await db.propertyImage.create({ data: { propertyId: first.id, file: '/uploads/unavailable-manual.webp',
      kind: 'plan', planRole: 'floor', alt: 'План этажа', order: 5 } });
    const incoming = await draft('78', 4_000_000, 3, [redUrl, blueUrl]);
    incoming.unitPlanImageUrls = [redUrl];
    incoming.floorPlanImageUrls = [blueUrl];
    const merged = await importProperty(incoming, parent.id);
    assert.equal(merged.id, first.id);
    assert.ok(merged.warnings.some(value => value.includes('сохранённый план №6')));
    const images = await db.propertyImage.findMany({ where: { propertyId: first.id }, orderBy: { order: 'asc' } });
    assert.equal(images.length, 3);
    assert.equal(images[1]!.id, manual.id);
    assert.equal(images[2]!.planRole, 'floor');
    assert.equal(images[2]!.order, 6);
  });

  await t.test('unlinked secondary imports reuse a complete gallery and preserve the first card and source aliases', async () => {
    async function secondary(price: number, floor: number, photos: string[]) {
      const value = await draft(null, price, floor, photos);
      value.data.housingMarket = 'secondary';
      value.planImageUrls = [];
      return value;
    }
    const firstDraft = await secondary(5_200_000, 5, [redUrl, commonUrl]);
    const first = await importProperty(firstDraft);
    const manual = await db.property.update({ where: { id: first.id }, data: { layoutHash: null, title: 'Ручная карточка',
      description: 'Сохранить описание', slug: 'manual-unlinked-apartment', published: true } });
    const secondDraft = await secondary(4_882_500, 2, [commonUrl, redCopy]);
    const second = await importProperty(secondDraft);
    assert.equal(second.id, first.id);
    assert.equal(second.created, false);
    const card = await db.property.findUniqueOrThrow({ where: { id: first.id }, include: { images: true, importSources: true } });
    assert.equal(card.price, 4_882_500);
    assert.equal(card.priceKind, 'from');
    assert.deepEqual(card.availableFloors, [2, 5]);
    assert.equal(card.floors, 20);
    assert.equal(card.complexId, null);
    assert.equal(card.images.length, 2);
    assert.equal(card.importSources.length, 2);
    assert.equal(card.importSources.find(source => source.sourceId === firstDraft.data.sourceId)?.price, 5_200_000);
    for (const key of ['title', 'description', 'slug', 'published'] as const) assert.equal(card[key], manual[key]);
    const before = requests;
    assert.equal((await importProperty(secondDraft)).id, first.id);
    assert.equal(requests, before, 'Repeat source IDs do not redownload images.');
    const sharedPhoto = await importProperty(await secondary(5_000_000, 3, [commonUrl, blueUrl]));
    assert.notEqual(sharedPhoto.id, first.id);
    const elsewhere = await secondary(5_000_000, 3, [redUrl, commonUrl]);
    elsewhere.data.address = 'Тестовая, 2';
    assert.notEqual((await importProperty(elsewhere)).id, first.id);
    const partial = await secondary(5_000_000, 3, [redUrl, commonUrl, image(blue)]);
    media.delete(partial.imageUrls.at(-1)!);
    const failed = await importProperty(partial);
    assert.notEqual(failed.id, first.id);
    assert.ok(failed.warnings.some(warning => warning.includes('пропущена')));
  });

  await t.test('later imports and cleanup cannot turn a previously incomplete gallery into a match', async () => {
    const partial = await draft(null, 5_000_000, 2, [redUrl, image(blue)]);
    partial.data.housingMarket = 'secondary';
    partial.data.address = 'Неполная, 9';
    partial.planImageUrls = [];
    media.delete(partial.imageUrls.at(-1)!);
    const first = await importProperty(partial);
    assert.equal((await db.property.findUniqueOrThrow({ where: { id: first.id } })).layoutHash, '');
    const full = await draft(null, 4_000_000, 3, [redUrl]);
    full.data.housingMarket = 'secondary';
    full.data.address = partial.data.address;
    full.planImageUrls = [];
    const second = await importProperty(full);
    assert.notEqual(second.id, first.id);
    const { deduplicateApartmentLayout } = await import('../server/utils/apartment-layout-cleanup');
    assert.equal((await deduplicateApartmentLayout(first.id, true)).merged, 0);
    assert.equal((await deduplicateApartmentLayout(second.id, true)).merged, 0);
    await db.property.update({ where: { id: first.id }, data: { layoutHash: null } });
    assert.equal((await deduplicateApartmentLayout(first.id, true)).merged, 0, 'Legacy notes also keep failed galleries separate.');
    assert.equal(await db.property.count({ where: { address: partial.data.address } }), 2);
  });

  await t.test('concurrent offers in one external complex create a single group without losing lower prices or floors', async () => {
    const drafts = await Promise.all([draft('75', 5_200_000, 5, [redUrl]), draft('75', 4_882_500, 2, [redCopy]), draft('75', 5_000_000, 8, [redUrl])]);
    const results = await Promise.all(drafts.map(value => importProperty(value)));
    assert.equal(new Set(results.map(result => result.id)).size, 1);
    assert.equal(results.filter(result => result.created).length, 1);
    const card = await db.property.findUniqueOrThrow({ where: { id: results[0]!.id } });
    assert.equal(card.price, 4_882_500);
    assert.deepEqual(card.availableFloors, [2, 5, 8]);
    assert.equal(await db.propertyImportSource.count({ where: { propertyId: card.id } }), 3);
  });
});
