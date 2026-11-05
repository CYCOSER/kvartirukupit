import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import { db } from '../server/utils/db';
import { getRf39FeedSettings, saveRf39FeedSettings, scheduleRf39FeedSync, startRf39FeedSync } from '../server/utils/rf39-feed-settings';
import { DEFAULT_RF39_FEED_URL, feedSyncInputSchema, feedSyncRunSchema } from '../shared/feed-sync';

test('feed sync settings default to disabled and accept only bounded RF39 XML URLs', () => {
  assert.deepEqual(feedSyncInputSchema.parse({}), { url: DEFAULT_RF39_FEED_URL, enabled: false, intervalMinutes: 60 });
  assert.equal(feedSyncInputSchema.parse({ url: ' https://feed.rf39.ru/123.xml ', enabled: true, intervalMinutes: 15 }).url, 'https://feed.rf39.ru/123.xml');
  for (const url of [
    'http://feed.rf39.ru/30.xml', 'https://localhost/30.xml', 'https://127.0.0.1/30.xml',
    'https://feed.rf39.ru.evil.test/30.xml', 'https://user:pass@feed.rf39.ru/30.xml',
    'https://feed.rf39.ru:443/30.xml', 'https://feed.rf39.ru/30.xml?target=private',
    'https://feed.rf39.ru/30.xml#fragment', 'https://feed.rf39.ru/path/30.xml',
    'https://feed.rf39.ru/../30.xml', 'https://feed.rf39.ru/%33%30.xml',
  ]) assert.equal(feedSyncInputSchema.safeParse({ url }).success, false, url);
  for (const intervalMinutes of [0, 14, 15.5, 10081, '60'])
    assert.equal(feedSyncInputSchema.safeParse({ intervalMinutes }).success, false);
  assert.equal(feedSyncInputSchema.safeParse({ intervalMinutes: 10080 }).success, true);
  assert.equal(feedSyncInputSchema.safeParse({ enabled: 'true' }).success, false);
  assert.equal(feedSyncInputSchema.safeParse({ extra: true }).success, false);
});

test('manual sync requests require an idempotency UUID', () => {
  assert.equal(feedSyncRunSchema.safeParse({ requestId: '3ab0972e-8ea8-49a9-971c-2d41d51b473a' }).success, true);
  assert.equal(feedSyncRunSchema.safeParse({}).success, false);
  assert.equal(feedSyncRunSchema.safeParse({ requestId: 'arbitrary' }).success, false);
  assert.equal(feedSyncRunSchema.safeParse({ requestId: '3ab0972e-8ea8-49a9-971c-2d41d51b473a', enabled: true }).success, false);
});

function fixture(t: TestContext) {
  const state = { setting: null as any, jobs: [] as any[], locks: 0, transactions: 0, failUpdate: false, beforeLock: undefined as (() => void) | undefined };
  const original: [any, string, any][] = [];
  const mock = (target: any, method: string, replacement: any) => {
    original.push([target, method, target[method]]);
    target[method] = replacement;
  };
  const copy = <T>(value: T): T => structuredClone(value);
  const matches = (row: any, where: any = {}): boolean => Object.entries(where).every(([key, value]: [string, any]) =>
    key === 'ownerId_requestId' ? matches(row, value) : value && typeof value === 'object' && 'in' in value ? value.in.includes(row[key]) : row[key] === value);
  const findJob = ({ where }: any) => copy(state.jobs.find(row => matches(row, where)) || null);
  mock(db.feedSyncSetting, 'findUnique', async () => copy(state.setting));
  mock(db.feedSyncSetting, 'upsert', async ({ create, update }: any) => {
    state.setting = state.setting ? { ...state.setting, ...copy(update) } : {
      enabled: false, intervalMinutes: 60, nextRunAt: null, lastSuccessAt: null, lastError: null, lastJobId: null, ...copy(create),
    };
    return copy(state.setting);
  });
  mock(db.feedSyncSetting, 'update', async ({ data }: any) => {
    if (state.failUpdate) throw new Error('Database unavailable');
    assert.ok(state.setting);
    Object.assign(state.setting, copy(data));
    return copy(state.setting);
  });
  mock(db.importJob, 'findFirst', async (args: any) => findJob(args));
  mock(db.importJob, 'findUnique', async (args: any) => findJob(args));
  mock(db.importJob, 'create', async ({ data }: any) => {
    const now = new Date();
    const job = { id: randomUUID(), status: 'queued', stopRequested: false, total: 0, processed: 0,
      created: 0, updated: 0, unpublished: 0, linked: 0, existing: 0, failed: 0, activeTitle: '', error: null,
      createdAt: now, updatedAt: now, finishedAt: null, ...copy(data) };
    state.jobs.push(job);
    return copy(job);
  });
  mock(db, '$executeRaw', async (sql: TemplateStringsArray) => {
    assert.match(sql.join(''), /pg_advisory_xact_lock\(hashtext\('rf39-feed-schedule'\)\)/);
    state.locks++;
    state.beforeLock?.();
  });
  mock(db, '$transaction', async (callback: any) => {
    state.transactions++;
    const before = copy({ setting: state.setting, jobs: state.jobs });
    try { return await callback(db); }
    catch (error) { state.setting = before.setting; state.jobs = before.jobs; throw error; }
  });
  t.after(() => { for (const [target, method, value] of original.reverse()) target[method] = value; });
  return state;
}

test('settings are read without creating a schedule; saving preserves an unchanged due time and disabling clears it', async t => {
  const f = fixture(t);
  assert.deepEqual(await getRf39FeedSettings('owner'), {
    url: DEFAULT_RF39_FEED_URL, enabled: false, intervalMinutes: 60, nextRunAt: null,
    lastSuccessAt: null, lastError: null, lastJobId: null, activeJobId: null,
  });
  assert.equal(Boolean(f.setting), false);
  const before = Date.now();
  const enabled = { url: DEFAULT_RF39_FEED_URL, enabled: true, intervalMinutes: 15 };
  await saveRf39FeedSettings('owner', enabled);
  assert.equal(f.setting.ownerId, 'owner');
  assert.ok(f.setting.nextRunAt.getTime() >= before + 15 * 60000);
  const due = new Date(0);
  f.setting.nextRunAt = due;
  await saveRf39FeedSettings('owner', enabled);
  assert.deepEqual(f.setting.nextRunAt, due);
  await saveRf39FeedSettings('owner', { ...enabled, enabled: false });
  assert.equal(f.setting.nextRunAt, null);
  assert.equal(f.locks, 3);
});

test('manual sync is idempotent, creates its durable plan, and only one global run can be active', async t => {
  const f = fixture(t);
  const requestId = randomUUID();
  const job = await startRf39FeedSync('owner', requestId);
  assert.equal((await startRf39FeedSync('owner', requestId)).id, job.id);
  assert.equal((await startRf39FeedSync('owner', randomUUID())).id, job.id);
  assert.equal(f.jobs.length, 1);
  assert.equal(f.setting.lastJobId, job.id);
  assert.equal(f.jobs[0].items.create.key, 'feed-plan');
  assert.equal(f.jobs[0].request.feedUrl, DEFAULT_RF39_FEED_URL);
  await assert.rejects(startRf39FeedSync('other-owner', randomUUID()), { statusCode: 409 });
  const owner = await getRf39FeedSettings('owner'), other = await getRf39FeedSettings('other-owner');
  assert.deepEqual([owner.activeJobId, owner.lastJobId], [job.id, job.id]);
  assert.deepEqual([other.activeJobId, other.lastJobId], [null, null]);
  f.jobs[0].status = 'failed';
  f.setting.lastError = 'XML недоступен';
  assert.equal((await getRf39FeedSettings('owner')).lastError, 'XML недоступен');
  assert.equal((await startRf39FeedSync('owner', requestId)).id, job.id);
  const retry = await startRf39FeedSync('owner', randomUUID());
  assert.notEqual(retry.id, job.id);
  assert.equal(f.setting.lastError, null);
  assert.equal(f.jobs.length, 2);
  f.jobs[1].kind = 'import';
  await assert.rejects(startRf39FeedSync('owner', f.jobs[1].requestId), { statusCode: 409 });
  assert.equal(f.locks, f.transactions);
});

test('scheduler skips disabled/future settings and atomically enqueues a due run without duplicates', async t => {
  const f = fixture(t);
  await scheduleRf39FeedSync();
  f.setting = { id: 'rf39', ownerId: 'owner', url: DEFAULT_RF39_FEED_URL, enabled: false, intervalMinutes: 60, nextRunAt: new Date(0) };
  await scheduleRf39FeedSync();
  f.setting.enabled = true;
  f.setting.nextRunAt = new Date(Date.now() + 60000);
  await scheduleRf39FeedSync();
  assert.equal(f.transactions, 0);
  f.setting.nextRunAt = new Date(0);
  const before = Date.now();
  await scheduleRf39FeedSync();
  assert.equal(f.jobs.length, 1);
  assert.equal(f.jobs[0].ownerId, 'owner');
  assert.equal(f.setting.lastJobId, f.jobs[0].id);
  assert.ok(f.setting.nextRunAt.getTime() >= before + 60 * 60000);
  f.setting.nextRunAt = new Date(0);
  await scheduleRf39FeedSync();
  assert.equal(f.jobs.length, 1);
  f.jobs[0].status = 'failed';
  f.setting.nextRunAt = new Date(0);
  await scheduleRf39FeedSync();
  assert.equal(f.jobs.length, 2);
  assert.equal(f.locks, 3);
});

test('scheduler rechecks settings after obtaining the shared lock', async t => {
  const f = fixture(t);
  f.setting = { id: 'rf39', ownerId: 'owner', url: DEFAULT_RF39_FEED_URL, enabled: true, intervalMinutes: 60, nextRunAt: new Date(0) };
  f.beforeLock = () => { f.setting.enabled = false; };
  await scheduleRf39FeedSync();
  assert.equal(f.jobs.length, 0);
  assert.equal(f.locks, 1);
});

test('a failed enqueue rolls back the task and leaves the schedule due for another attempt', async t => {
  const f = fixture(t);
  f.setting = { id: 'rf39', ownerId: 'owner', url: DEFAULT_RF39_FEED_URL, enabled: true, intervalMinutes: 60, nextRunAt: new Date(0) };
  f.failUpdate = true;
  await assert.rejects(scheduleRf39FeedSync(), /Database unavailable/);
  assert.equal(f.jobs.length, 0);
  assert.equal(f.setting.lastJobId, undefined);
  assert.deepEqual(f.setting.nextRunAt, new Date(0));
});
