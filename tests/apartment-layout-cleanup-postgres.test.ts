import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';

const databaseUrl = process.env.RF39_TEST_DATABASE_URL;

test('PostgreSQL safely merges imported apartments with equal complete layouts', { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl!);
  const baseSchema = url.searchParams.get('schema') || '';
  assert.match(baseSchema, /^rf39_test_[a-z0-9_]+$/, 'Use a new rf39_test_* schema; application schemas are forbidden.');
  const schema = `${baseSchema}_layout_cleanup`;
  assert.ok(schema.length <= 63);
  url.searchParams.set('schema', schema);
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('pool_timeout', '2');
  const isolatedUrl = url.href;
  const setup = new PrismaClient({ datasourceUrl: isolatedUrl });
  const oldUrl = process.env.DATABASE_URL, oldUploadDir = process.env.UPLOAD_DIR;
  const dir = await mkdtemp(join(tmpdir(), 'apartment-layout-cleanup-'));
  let created = false, client: PrismaClient | undefined;
  t.after(async () => {
    await client?.$disconnect();
    if (created) await setup.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await setup.$disconnect();
    if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
    if (oldUploadDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = oldUploadDir;
    await rm(dir, { recursive: true, force: true });
  });
  await setup.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  created = true;
  await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url)),
    'migrate', 'deploy', '--schema', fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url))],
  { env: { ...process.env, DATABASE_URL: isolatedUrl }, timeout: 120000 });
  process.env.DATABASE_URL = isolatedUrl;
  process.env.UPLOAD_DIR = dir;
  const { db } = await import('../server/utils/db');
  client = db;
  const { deduplicateApartmentLayout } = await import('../server/utils/apartment-layout-cleanup');
  const { prepareApartmentLayout } = await import('../server/utils/apartment-layout');
  let index = 0;
  async function file(color: string, metadata = false) {
    const image = sharp({ create: { width: 48, height: 32, channels: 3, background: color } });
    const name = randomUUID() + '.webp';
    await writeFile(join(dir, name), await (metadata ? image.withMetadata() : image).webp({ lossless: true }).toBuffer());
    return '/uploads/' + name;
  }
  async function apartment(plan: string, extra: Record<string, unknown> = {}) {
    return db.property.create({ data: { title: 'Исходный заголовок', slug: randomUUID(), type: 'apartment', housingMarket: 'newbuild',
      sourceId: `nmarket:apartment:${++index}`, nmarketComplexId: 'nmarket-a', location: 'Тест', readiness: '', finish: '',
      description: 'Ручное описание', utilities: [], price: 7000000, floors: 25, availableFloors: [],
      images: { create: [{ file: plan, originalFile: plan, kind: 'plan', alt: 'Планировка', order: 0 }] }, ...extra } as any });
  }
  const plan = await file('#cc4411'), samePlan = await file('#cc4411', true), otherPlan = await file('#1144cc');

  await t.test('preview preserves records; apply retains first edits and moves source identities, leads and unique galleries', async () => {
    const keeper = await apartment(plan, { createdAt: new Date('2020-01-01'), availableFloors: [2], title: 'Ручной заголовок' });
    const duplicate = await apartment(samePlan, { createdAt: new Date('2021-01-01'), price: 6000000, availableFloors: [7] });
    const photo = await file('#229966');
    const uniquePhoto = await db.propertyImage.create({ data: { propertyId: duplicate.id, file: photo, originalFile: photo, alt: 'Особое фото', order: 1 } });
    await db.imageUpscale.create({ data: { imageId: uniquePhoto.id, sourceFile: photo, mode: 'photo', status: 'failed' } });
    await db.propertyImportSource.createMany({ data: [
      { sourceId: keeper.sourceId!, propertyId: keeper.id, apartmentKey: 'unit-a' },
      { sourceId: 'rf39:123', propertyId: duplicate.id, apartmentKey: 'unit-b' },
    ] });
    const lead = await db.lead.create({ data: { propertyId: duplicate.id, name: 'Тест', phone: '+70000000000', consent: true } });
    const files = await readdir(dir);
    const floors = new Map([[duplicate.sourceId!, { availableFloors: [9], price: 6000000 }], ['rf39:123', { availableFloors: [12], price: 6500000 }]]);
    const preview = await deduplicateApartmentLayout(duplicate.id, false, floors);
    assert.equal(preview.keeperId, keeper.id);
    assert.deepEqual(preview.duplicateIds, [duplicate.id]);
    assert.equal(preview.merged, 0);
    assert.equal(preview.price, 6000000);
    assert.deepEqual(preview.availableFloors, [2, 7, 9, 12]);
    assert.equal(await db.property.count(), 2);
    const result = await deduplicateApartmentLayout(duplicate.id, true, floors);
    assert.equal(result.merged, 1);
    const remaining = await db.property.findUniqueOrThrow({ where: { id: keeper.id }, include: { images: true, importSources: true } });
    assert.equal(remaining.title, 'Ручной заголовок');
    assert.equal(remaining.description, 'Ручное описание');
    assert.equal(remaining.price, 6000000);
    assert.equal(remaining.priceKind, 'from');
    assert.equal(remaining.floors, 25);
    assert.deepEqual(remaining.availableFloors, [2, 7, 9, 12]);
    assert.ok(remaining.layoutHash);
    assert.equal(remaining.images.length, 2);
    assert.equal(remaining.images.find(image => image.id === uniquePhoto.id)?.propertyId, keeper.id);
    assert.equal(await db.imageUpscale.count(), 1);
    assert.deepEqual(remaining.importSources.map(source => source.sourceId).sort(), [keeper.sourceId!, duplicate.sourceId!, 'rf39:123'].sort());
    assert.equal(remaining.importSources.find(source => source.sourceId === 'rf39:123')?.apartmentKey, 'unit-b');
    assert.equal(remaining.importSources.find(source => source.sourceId === duplicate.sourceId)?.price, 6000000);
    assert.deepEqual(remaining.importSources.find(source => source.sourceId === duplicate.sourceId)?.availableFloors, [9]);
    assert.equal(remaining.importSources.find(source => source.sourceId === 'rf39:123')?.price, 6500000);
    assert.equal((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).propertyId, keeper.id);
    assert.equal(await db.property.findUnique({ where: { id: duplicate.id } }), null);
    assert.deepEqual(await readdir(dir), files);
    assert.equal((await deduplicateApartmentLayout(keeper.id, true, floors)).merged, 0);
  });

  await t.test('different developments, incomplete plan sets, secondary and manual cards remain separate', async () => {
    const base = await apartment(plan, { nmarketComplexId: 'scope-b' });
    const otherDevelopment = await apartment(samePlan, { nmarketComplexId: 'scope-c' });
    const fullSet = await apartment(plan, { nmarketComplexId: 'scope-b' });
    await db.propertyImage.create({ data: { propertyId: fullSet.id, file: otherPlan, originalFile: otherPlan, kind: 'plan', alt: 'Второй этаж' } });
    const manual = await apartment(plan, { nmarketComplexId: 'scope-b', sourceId: null });
    const secondary = await apartment(plan, { nmarketComplexId: 'scope-b', housingMarket: 'secondary' });
    const noPlan = await apartment(plan, { nmarketComplexId: 'scope-b' });
    await db.propertyImage.updateMany({ where: { propertyId: noPlan.id }, data: { kind: 'photo' } });
    assert.equal((await deduplicateApartmentLayout(base.id, true)).merged, 0);
    assert.equal(await db.property.count({ where: { id: { in: [base.id, otherDevelopment.id, fullSet.id, manual.id, secondary.id, noPlan.id] } } }), 6);
  });

  await t.test('conflicting local complex links and source ownership prevent destructive merges', async () => {
    const complex = (title: string) => db.property.create({ data: { title, slug: randomUUID(), type: 'complex', location: 'Тест', readiness: '', finish: '', description: '', utilities: [] } });
    const a = await complex('A'), b = await complex('B');
    const unlinked = await apartment(plan, { nmarketComplexId: 'ambiguous' });
    const first = await apartment(plan, { nmarketComplexId: 'ambiguous', complexId: a.id });
    const second = await apartment(plan, { nmarketComplexId: 'ambiguous', complexId: b.id });
    const result = await deduplicateApartmentLayout(unlinked.id, true);
    assert.equal(result.merged, 0);
    assert.ok(result.warnings.some(warning => warning.includes('разными карточками ЖК')));
    assert.equal((await deduplicateApartmentLayout(first.id, true)).merged, 0);
    assert.equal((await deduplicateApartmentLayout(second.id, true)).merged, 0);
    const owner = await apartment(otherPlan, { nmarketComplexId: 'ownership' });
    const duplicate = await apartment(plan, { nmarketComplexId: 'ownership' });
    const twin = await apartment(samePlan, { nmarketComplexId: 'ownership' });
    await db.propertyImportSource.create({ data: { sourceId: duplicate.sourceId!, propertyId: owner.id } });
    assert.equal((await deduplicateApartmentLayout(twin.id, true)).merged, 0);
    assert.equal(await db.property.count({ where: { id: { in: [unlinked.id, first.id, second.id, owner.id, duplicate.id, twin.id] } } }), 6);
  });

  await t.test('galleries over 100 unique images are preserved without partial data changes', async () => {
    const first = await apartment(plan, { nmarketComplexId: 'large' }), second = await apartment(samePlan, { nmarketComplexId: 'large', price: 1000000 });
    const photos = [];
    for (let i = 0; i < 100; i++) photos.push({ propertyId: i < 50 ? first.id : second.id,
      file: await file(`#${(i * 12347 + 1).toString(16).padStart(6, '0')}`), alt: `Фото ${i}`, order: i + 1 });
    await db.propertyImage.createMany({ data: photos });
    const result = await deduplicateApartmentLayout(first.id, true);
    assert.equal(result.merged, 0);
    assert.ok(result.warnings.some(warning => warning.includes('100')));
    assert.equal((await db.property.findUniqueOrThrow({ where: { id: first.id } })).price, 7000000);
    assert.equal(await db.property.count({ where: { id: { in: [first.id, second.id] } } }), 2);
  });

  await t.test('locked recheck ignores a stale layoutHash after the plans changed', async () => {
    const first = await apartment(plan, { nmarketComplexId: 'changed' }), second = await apartment(samePlan, { nmarketComplexId: 'changed' });
    const hash = await prepareApartmentLayout(first, [{ file: plan, kind: 'plan' }]);
    await db.property.updateMany({ where: { id: { in: [first.id, second.id] } }, data: { layoutHash: hash } });
    await db.propertyImage.updateMany({ where: { propertyId: second.id }, data: { file: otherPlan, originalFile: otherPlan } });
    assert.equal((await deduplicateApartmentLayout(first.id, true)).merged, 0);
  });
});
