import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';

const databaseUrl = process.env.RF39_TEST_DATABASE_URL;

test('PostgreSQL duplicate cleanup uses one pooled connection and protects concurrent image edits', { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl!);
  const baseSchema = url.searchParams.get('schema') || '';
  assert.match(baseSchema, /^rf39_test_[a-z0-9_]+$/, 'Use a new rf39_test_* schema; application schemas are forbidden.');
  const schema = `${baseSchema}_images`;
  assert.ok(schema.length <= 63, 'The test schema must fit a PostgreSQL identifier.');
  url.searchParams.set('schema', schema);
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('pool_timeout', '2');
  const isolatedUrl = url.href;
  const setup = new PrismaClient({ datasourceUrl: isolatedUrl });
  const editor = new PrismaClient({ datasourceUrl: isolatedUrl });
  const oldUrl = process.env.DATABASE_URL, oldUploadDir = process.env.UPLOAD_DIR;
  const dir = await mkdtemp(join(tmpdir(), 'image-dedup-postgres-'));
  let created = false, client: PrismaClient | undefined;
  t.after(async () => {
    await client?.$disconnect();
    await editor.$disconnect();
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
  ], { env: { ...process.env, DATABASE_URL: isolatedUrl }, timeout: 120000 });
  process.env.DATABASE_URL = isolatedUrl;
  process.env.UPLOAD_DIR = dir;
  const { db } = await import('../server/utils/db');
  client = db;
  const { deduplicatePropertyImages } = await import('../server/utils/image-dedup');
  const red = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#cc4411' } }).png().toBuffer();
  const blue = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#1144cc' } }).png().toBuffer();
  async function file(bytes: Buffer) {
    const name = randomUUID() + '.webp';
    await writeFile(join(dir, name), bytes);
    return '/uploads/' + name;
  }
  async function property(title: string) {
    return db.property.create({ data: { title, slug: randomUUID(), type: 'apartment', location: 'Тест',
      readiness: '', finish: '', description: '', utilities: [] } });
  }
  const original = await file(red), metadata = await file(await sharp(red).withMetadata().png().toBuffer());
  const alternate = await file(await sharp(red).webp({ lossless: true }).toBuffer()), distinct = await file(blue);

  await t.test('deletes only duplicates in the chosen card, cascades upscale metadata and retains the plan at the first position', async () => {
    const card = await property('Cleanup test'), other = await property('Shared image');
    await db.propertyImage.createMany({ data: [
      { id: 'photo', propertyId: card.id, file: original, alt: 'Фото', order: 0 },
      { id: 'distinct', propertyId: card.id, file: distinct, alt: 'Другое фото', order: 1 },
      { id: 'plan', propertyId: card.id, file: metadata, alt: 'План', kind: 'plan', order: 2 },
      { id: 'duplicate', propertyId: card.id, file: alternate, alt: 'Дубль', order: 3 },
      { id: 'other-card', propertyId: other.id, file: original, alt: 'Общее фото', order: 0 },
    ] });
    await db.imageUpscale.create({ data: { imageId: 'photo', sourceFile: original, mode: 'photo', status: 'failed' } });
    const files = await readdir(dir);
    assert.deepEqual(await deduplicatePropertyImages(card.id), { scanned: 4, duplicates: 2, deleted: 0, warnings: [] });
    assert.equal(await db.propertyImage.count(), 5);
    assert.deepEqual(await deduplicatePropertyImages(card.id, true), { scanned: 4, duplicates: 2, deleted: 2, warnings: [] });
    assert.deepEqual(await db.propertyImage.findMany({ where: { propertyId: card.id }, select: { id: true, order: true }, orderBy: { order: 'asc' } }),
      [{ id: 'plan', order: 0 }, { id: 'distinct', order: 1 }]);
    assert.equal(await db.propertyImage.count({ where: { propertyId: other.id } }), 1);
    assert.equal(await db.imageUpscale.count(), 0);
    assert.deepEqual(await readdir(dir), files);
    assert.deepEqual(await deduplicatePropertyImages(card.id, true), { scanned: 2, duplicates: 0, deleted: 0, warnings: [] });
  });

  await t.test('waits for an in-flight edit and preserves its now-distinct image', async () => {
    const card = await property('Concurrent edit');
    await db.propertyImage.createMany({ data: [
      { id: 'edit-first', propertyId: card.id, file: original, alt: 'Первое', order: 0 },
      { id: 'edit-second', propertyId: card.id, file: alternate, alt: 'Редактируется', order: 1 },
    ] });
    const [{ pid }] = await db.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    let release!: () => void, locked!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const editLocked = new Promise<void>(resolve => { locked = resolve; });
    const editing = editor.$transaction(async tx => {
      await tx.propertyImage.update({ where: { id: 'edit-second' }, data: { file: distinct } });
      locked();
      await released;
    }, { timeout: 10000 });
    let cleaning: ReturnType<typeof deduplicatePropertyImages> | undefined;
    let result: Awaited<ReturnType<typeof deduplicatePropertyImages>> | undefined;
    try {
      await Promise.race([editLocked, editing]);
      cleaning = deduplicatePropertyImages(card.id, true);
      void cleaning.catch(() => {});
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const activity = await setup.$queryRaw<{ wait_event_type: string | null }[]>`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}`;
        if (activity[0]?.wait_event_type === 'Lock') { waiting = true; break; }
        await setTimeout(20);
      }
      assert.equal(waiting, true, 'Cleanup must wait for the edited row lock.');
    } finally { release(); await editing; result = await cleaning; }
    assert.deepEqual(result, { scanned: 2, duplicates: 0, deleted: 0, warnings: [] });
    assert.equal(await db.propertyImage.count({ where: { propertyId: card.id } }), 2);
    assert.equal((await db.propertyImage.findUniqueOrThrow({ where: { id: 'edit-second' } })).file, distinct);
  });
});
