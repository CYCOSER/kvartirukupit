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
import { DEFAULT_RF39_FEED_URL } from '../shared/feed-sync';
import { rf39ManualBaseline } from '../shared/rf39-feed-merge';
import { rf39Draft } from '../server/utils/rf39-data';

const databaseUrl = process.env.RF39_TEST_DATABASE_URL;

test('PostgreSQL XML worker batches cards, preserves edits and isolates recoverable failures', { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl!);
  const baseSchema = url.searchParams.get('schema') || '';
  assert.match(baseSchema, /^rf39_test_[a-z0-9_]+$/, 'Use a new rf39_test_* schema; application schemas are forbidden.');
  const schema = `${baseSchema}_worker`;
  assert.ok(schema.length <= 63, 'The test schema must fit a PostgreSQL identifier.');
  url.searchParams.set('schema', schema);
  const workerUrl = url.href;
  const setup = new PrismaClient({ datasourceUrl: workerUrl });
  const oldUrl = process.env.DATABASE_URL, oldUploadDir = process.env.UPLOAD_DIR, oldFetch = globalThis.fetch;
  const dir = await mkdtemp(join(tmpdir(), 'rf39-worker-postgres-'));
  let created = false, client: PrismaClient | undefined;
  t.after(async () => {
    globalThis.fetch = oldFetch;
    await client?.$disconnect();
    if (created) await setup.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await setup.$disconnect();
    if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
    if (oldUploadDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = oldUploadDir;
    await rm(dir, { recursive: true, force: true });
  });
  // Never reuse a schema: cleanup is limited to data created by this test.
  await setup.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  created = true;
  await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url)), 'migrate', 'deploy',
    '--schema', fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)),
  ], { env: { ...process.env, DATABASE_URL: workerUrl }, timeout: 120000 });
  process.env.DATABASE_URL = workerUrl;
  process.env.UPLOAD_DIR = join(dir, 'uploads');
  const { db } = await import('../server/utils/db');
  client = db;
  const { processRf39FeedJob } = await import('../server/utils/rf39-feed-sync');
  const { startRf39FeedSync } = await import('../server/utils/rf39-feed-settings');
  const { ImportOwnershipLost } = await import('../server/utils/import-execution');
  const owner = await db.adminUser.create({ data: { email: `${randomUUID()}@test.invalid`, passwordHash: 'unused' } });
  const config = { rf39SnapshotPath: join(dir, 'feed.json'), nmarketFeedUrl: '', nmarketSnapshotPath: '' };
  const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#33aa77' } }).png().toBuffer();
  const offer = (id: number, price = 10000000, extra = '') => `<offer internal-id="test-${id}"><url>https://rf39.ru/catalog/sale/flat/object/${id}/</url><type>продажа</type><property-type>жилая</property-type><category>квартира</category><location><locality-name>Калининград</locality-name><address>Тестовая, ${id}</address></location><price><value>${price}</value><currency>RUR</currency></price><area><value>50</value><unit>кв. м</unit></area><rooms>2</rooms><description>Описание тестовой квартиры из XML.</description>${extra}</offer>`;
  let xml = '', feedRequests = 0, imageRequests = 0, stopOnImage = false, activeId = '';
  const feed = (offers: string[]) => { xml = `<realty-feed xmlns="http://webmaster.yandex.ru/schemas/feed/realty/2010-06">${offers.join('')}</realty-feed>`; };
  globalThis.fetch = async input => {
    if (String(input) === DEFAULT_RF39_FEED_URL) { feedRequests++; return new Response(xml); }
    assert.equal(String(input), 'https://rf39.ru/images/objects/test.png', 'Integration tests must not access external networks.');
    imageRequests++;
    if (stopOnImage) await db.importJob.update({ where: { id: activeId }, data: { stopRequested: true } });
    return new Response(image, { headers: { 'content-type': 'image/png' } });
  };
  async function execute(id?: string) {
    activeId = id || (await startRf39FeedSync(owner.id, randomUUID())).id;
    const token = randomUUID();
    const job = await db.importJob.update({ where: { id: activeId }, data: { status: 'running', token, stopRequested: false } });
    await processRf39FeedJob(job, config, { guard: async tx => {
      const rows = await tx.$queryRaw<{ status: string; token: string | null }[]>`SELECT "status", "token" FROM "ImportJob" WHERE "id" = ${job.id} FOR UPDATE`;
      if (rows[0]?.status !== 'running' || rows[0]?.token !== token) throw new ImportOwnershipLost();
    } });
    return db.importJob.findUniqueOrThrow({ where: { id: job.id } });
  }

  await t.test('1000 synthetic apartments are published with durable batched checkpoints', async () => {
    feed(Array.from({ length: 1000 }, (_, index) => offer(index + 1)));
    const started = performance.now();
    const job = await execute();
    t.diagnostic(`1000 synthetic apartments, real PostgreSQL, no image downloads: ${Math.round(performance.now() - started)} ms`);
    assert.deepEqual([job.status, job.created, job.processed, job.total, job.failed], ['completed', 1000, 1000, 1000, 0]);
    assert.equal(await db.property.count({ where: { published: true, elite: true, type: 'apartment' } }), 1000);
    assert.equal(await db.propertyImportSource.count(), 1000);
    assert.equal(await db.importJobItem.count({ where: { jobId: job.id, kind: 'feed-import', status: 'completed' } }), 1000);
    assert.equal(feedRequests, 1);
  });

  await t.test('repeat sync preserves explicit manual edits and photos, updates other fields and removes only absent primary CRM cards', async () => {
    const manual = await db.property.findUniqueOrThrow({ where: { sourceId: 'rf39:1' } });
    await db.property.update({ where: { id: manual.id }, data: {
      title: 'Ручной заголовок', price: 8000000,
      rf39Baseline: JSON.parse(JSON.stringify(rf39ManualBaseline(manual.rf39Baseline, ['title', 'price']))),
      images: { create: { file: '/uploads/manual.webp', alt: 'Ручная фотография', order: 0 } },
    } });
    await db.property.update({ where: { sourceId: 'rf39:3' }, data: { sourceId: 'nmarket:apartment:3' } });
    feed([offer(1, 8000000), offer(2, 11000000)]);
    const job = await execute();
    assert.deepEqual([job.created, job.updated, job.unpublished, job.failed], [0, 1, 997, 0]);
    assert.equal((await db.property.findUniqueOrThrow({ where: { sourceId: 'nmarket:apartment:3' } })).published, true);
    assert.equal((await db.property.findUniqueOrThrow({ where: { sourceId: 'rf39:2' } })).price, 11000000);
    feed([offer(1, 9000000), offer(2, 12000000)]);
    await execute();
    const kept = await db.property.findUniqueOrThrow({ where: { id: manual.id }, include: { images: true } });
    assert.equal(kept.price, 8000000);
    assert.equal(kept.title, 'Ручной заголовок');
    assert.equal(kept.images[0]?.file, '/uploads/manual.webp');
    assert.equal(await db.property.count(), 1000);
  });

  await t.test('a malformed offer prevents absence cleanup while valid offers still update', async () => {
    await db.property.update({ where: { sourceId: 'rf39:1000' }, data: { published: true } });
    feed([offer(2, 13000000), offer(4, 10000000, '<rooms>3</rooms>')]);
    const job = await execute();
    assert.deepEqual([job.status, job.updated, job.failed, job.unpublished], ['completed', 1, 1, 0]);
    assert.match(job.error || '', /не снимались/);
    assert.equal((await db.property.findUniqueOrThrow({ where: { sourceId: 'rf39:1000' } })).published, true);
  });

  await t.test('an actual PostgreSQL check violation rolls back its batch then continues with independent cards', async () => {
    await db.$executeRawUnsafe('ALTER TABLE "Property" ADD CONSTRAINT "rf39_worker_test_check" CHECK ("sourceId" <> \'rf39:2001\')');
    try {
      feed([offer(2001), offer(2002)]);
      const job = await execute();
      assert.deepEqual([job.status, job.created, job.failed, job.processed, job.unpublished], ['completed', 1, 1, 2, 0]);
      assert.equal(await db.property.count({ where: { sourceId: 'rf39:2001' } }), 0);
      assert.equal(await db.property.count({ where: { sourceId: 'rf39:2002' } }), 1);
    } finally { await db.$executeRawUnsafe('ALTER TABLE "Property" DROP CONSTRAINT "rf39_worker_test_check"'); }
  });

  await t.test('manual stop preserves existing publications, then resumes saved work without refetching XML or images', async () => {
    stopOnImage = true;
    feed([offer(3001, 10000000, '<image>https://rf39.ru/images/objects/test.png</image>'), offer(3002)]);
    const job = await execute();
    assert.deepEqual([job.status, job.created, job.unpublished], ['stopped', 0, 0]);
    assert.equal((await db.property.findUniqueOrThrow({ where: { sourceId: 'rf39:1000' } })).published, true);
    const requests = feedRequests;
    stopOnImage = false;
    await db.$disconnect();
    const resumed = await execute(job.id);
    assert.deepEqual([resumed.status, resumed.created, resumed.processed, resumed.failed], ['completed', 2, 2, 0]);
    assert.equal(feedRequests, requests);
    assert.equal(imageRequests, 1);
    assert.equal(await db.propertyImage.count({ where: { property: { sourceId: 'rf39:3001' } } }), 1);
  });

  await t.test('stored scoped XML jobs group plans across batches and retain a surviving offer when the primary and cheapest disappear', async () => {
    const planUrl = 'https://rf39.ru/images/objects/test.png';
    const draft = (id: number, price: number, floor: number) => {
      const value = rf39Draft({ id, type: 'Квартиры в новостройках', deal_type: 'sale', city: 'Калининград',
        address: 'Тестовая, 1', price, development: { id: 88 }, params: { area: { value: 27.9 }, rooms: { value: 0 },
          floor: { value: floor }, 'floors-total': { value: 30 } } });
      return { ...value, imageUrls: [planUrl], planImageUrls: [planUrl] };
    };
    async function stored(values: ReturnType<typeof draft>[]) {
      const job = await startRf39FeedSync(owner.id, randomUUID());
      await db.importJobItem.update({ where: { jobId_key: { jobId: job.id, key: 'feed-plan' } }, data: { status: 'completed', result: {
        presentIds: values.map(value => Number(value.data.sourceId.split(':')[1])), authoritative: true,
        snapshotDate: new Date().toISOString(), fetchedAt: new Date().toISOString(),
      } } });
      await db.importJobItem.createMany({ data: values.map((value, step) => ({ jobId: job.id, key: `feed:${value.data.sourceId}`,
        kind: 'feed-import', source: 'rf39', title: value.data.title, groupOrder: 0, step,
        payload: JSON.parse(JSON.stringify(value)),
      })) });
      await db.importJob.update({ where: { id: job.id }, data: { total: values.length } });
      return execute(job.id);
    }
    const job = await stored(Array.from({ length: 26 }, (_, i) => draft(4001 + i, 9_000_000 - i * 1000, i + 1)));
    assert.deepEqual([job.created, job.processed, job.failed], [1, 26, 0]);
    const first = await db.property.findUniqueOrThrow({ where: { sourceId: 'rf39:4001' } });
    assert.equal(first.price, 8_975_000);
    assert.deepEqual(first.availableFloors, Array.from({ length: 26 }, (_, i) => i + 1));
    assert.equal(await db.propertyImportSource.count({ where: { propertyId: first.id } }), 26);
    await db.property.update({ where: { id: first.id }, data: { title: 'Ручное название планировки' } });
    const repeat = await stored([draft(4002, 9_500_000, 30)]);
    assert.deepEqual([repeat.created, repeat.failed], [0, 0]);
    const remaining = await db.property.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(remaining.published, true);
    assert.equal(remaining.price, 9_500_000);
    assert.deepEqual(remaining.availableFloors, [30]);
    assert.equal(remaining.title, 'Ручное название планировки');
    assert.equal(await db.property.count({ where: { rf39ComplexId: '88' } }), 1);
  });
});
