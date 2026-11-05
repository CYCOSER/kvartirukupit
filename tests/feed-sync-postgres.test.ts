import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_RF39_FEED_URL } from '../shared/feed-sync';

const databaseUrl = process.env.RF39_TEST_DATABASE_URL;

test('PostgreSQL serializes manual and automatic XML jobs in an isolated schema', { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl!);
  const schema = url.searchParams.get('schema') || '';
  assert.match(schema, /^rf39_test_[a-z0-9_]+$/, 'Use a new rf39_test_* schema; application schemas are forbidden.');
  const setup = new PrismaClient({ datasourceUrl: databaseUrl });
  let created = false;
  let client: PrismaClient | undefined;
  const previousUrl = process.env.DATABASE_URL;
  t.after(async () => {
    await client?.$disconnect();
    if (created) await setup.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await setup.$disconnect();
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  });
  // CREATE refuses an existing schema, so cleanup can only remove this test's own data.
  await setup.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  created = true;
  await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url)), 'migrate', 'deploy',
    '--schema', fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)),
  ], { env: { ...process.env, DATABASE_URL: databaseUrl! }, timeout: 120000 });
  process.env.DATABASE_URL = databaseUrl;
  const { db } = await import('../server/utils/db');
  client = db;
  const { getRf39FeedSettings, saveRf39FeedSettings, scheduleRf39FeedSync, startRf39FeedSync } = await import('../server/utils/rf39-feed-settings');
  const owner = await db.adminUser.create({ data: { email: `${randomUUID()}@test.invalid`, passwordHash: 'unused' } });
  const other = await db.adminUser.create({ data: { email: `${randomUUID()}@test.invalid`, passwordHash: 'unused' } });
  const input = { url: DEFAULT_RF39_FEED_URL, enabled: true, intervalMinutes: 15 };

  await t.test('simultaneous manual requests reuse one durable job and protect ownership', async () => {
    const requestId = randomUUID();
    const results = await Promise.all(Array.from({ length: 6 }, () => startRf39FeedSync(owner.id, requestId)));
    assert.equal(new Set(results.map(result => result.id)).size, 1);
    assert.equal(await db.importJob.count(), 1);
    assert.equal(await db.importJobItem.count({ where: { key: 'feed-plan' } }), 1);
    const job = results[0]!;
    await assert.rejects(startRf39FeedSync(other.id, randomUUID()), { statusCode: 409 });
    assert.equal((await getRf39FeedSettings(other.id)).activeJobId, null);
    assert.equal((await getRf39FeedSettings(other.id)).lastJobId, null);
    await db.importJob.update({ where: { id: job.id }, data: { status: 'failed' } });
    assert.equal((await startRf39FeedSync(owner.id, requestId)).id, job.id);
    assert.notEqual((await startRf39FeedSync(owner.id, randomUUID())).id, job.id);
  });

  await t.test('simultaneous due ticks and manual starts cannot create competing runs', async () => {
    await db.importJob.deleteMany();
    await saveRf39FeedSettings(owner.id, input);
    await db.feedSyncSetting.update({ where: { id: 'rf39' }, data: { nextRunAt: new Date(0) } });
    await Promise.all([
      ...Array.from({ length: 4 }, () => scheduleRf39FeedSync()),
      ...Array.from({ length: 4 }, () => startRf39FeedSync(owner.id, randomUUID())),
    ]);
    assert.equal(await db.importJob.count(), 1);
    assert.equal(await db.importJobItem.count(), 1);
    const setting = await db.feedSyncSetting.findUniqueOrThrow({ where: { id: 'rf39' } });
    assert.ok(setting.nextRunAt && setting.nextRunAt > new Date());
    assert.equal(setting.lastJobId, (await db.importJob.findFirstOrThrow()).id);
    const reconnected = new PrismaClient({ datasourceUrl: databaseUrl });
    try { assert.equal((await reconnected.feedSyncSetting.findUniqueOrThrow({ where: { id: 'rf39' } })).lastJobId, setting.lastJobId); }
    finally { await reconnected.$disconnect(); }
  });

  await t.test('a rejected owner leaves settings and jobs intact; disabled schedules stay idle', async () => {
    const before = await db.feedSyncSetting.findUniqueOrThrow({ where: { id: 'rf39' } });
    await assert.rejects(saveRf39FeedSettings('missing-admin', { ...input, intervalMinutes: 30 }), { code: 'P2003' });
    assert.deepEqual(await db.feedSyncSetting.findUniqueOrThrow({ where: { id: 'rf39' } }), before);
    await db.importJob.deleteMany();
    await saveRf39FeedSettings(owner.id, { ...input, enabled: false });
    await Promise.all(Array.from({ length: 3 }, () => scheduleRf39FeedSync()));
    assert.equal(await db.importJob.count(), 0);
    assert.equal((await getRf39FeedSettings(owner.id)).nextRunAt, null);
  });
});
