import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { db } from '../server/utils/db';
import { createImportJob, deleteImportJob, getImportJob, listImportJobs, processNextImportJob, retryImportJob, stopImportJob } from '../server/utils/import-jobs';
import { importJobRequestSchema } from '../shared/import-job';
import { DEFAULT_RF39_FEED_URL } from '../shared/feed-sync';
import { ImportOwnershipLost, type ImportConfig } from '../server/utils/import-execution';
import { cacheApartmentMatches } from '../server/utils/apartment-matching';

function memoryDatabase() {
  const tables: Record<string, any[]> = { importJob: [], importJobItem: [], property: [], propertyImportSource: [], importImageCache: [], feedSyncSetting: [] };
  const original: [any, string, any][] = [];
  const clone = <T>(value: T): T => structuredClone(value);
  function matches(row: any, where: any = {}): boolean {
    return Object.entries(where).every(([key, condition]: [string, any]) => {
      if (key === 'OR') return condition.some((part: any) => matches(row, part));
      if (key === 'ownerId_requestId' || key === 'jobId_key') return matches(row, condition);
      if (condition === null || typeof condition !== 'object' || condition instanceof Date) return row[key] === condition;
      return Object.entries(condition).every(([operator, value]: [string, any]) => {
        if (operator === 'in') return value.includes(row[key]);
        if (operator === 'notIn') return !value.includes(row[key]);
        if (operator === 'not') return row[key] !== value;
        if (operator === 'gt') return row[key] > value;
        if (operator === 'lte') return row[key] <= value;
        throw new Error(`Unsupported test comparison ${operator}`);
      });
    });
  }
  function update(row: any, data: any) {
    for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value
      ? row[key] + value.increment : clone(value);
    row.updatedAt = new Date();
    return row;
  }
  function replace(target: any, key: string, value: any) { original.push([target, key, target[key]]); target[key] = value; }
  for (const name of Object.keys(tables)) {
    const model = (db as any)[name];
    const find = (args: any = {}) => {
      let rows = tables[name].filter(row => matches(row, args.where));
      const order = Array.isArray(args.orderBy) ? args.orderBy : args.orderBy ? [args.orderBy] : [];
      rows = [...rows].sort((a, b) => {
        for (const part of order) for (const [key, direction] of Object.entries(part)) {
          const comparison = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
          if (comparison) return direction === 'desc' ? -comparison : comparison;
        }
        return 0;
      });
      if (args.take) rows = rows.slice(0, args.take);
      return rows.map(row => clone(args.include?.property ? { ...row, property: tables.property.find(property => property.id === row.propertyId) } : row));
    };
    const create = (data: any) => {
      const common = { id: `${name}-${randomUUID()}`, createdAt: new Date(), updatedAt: new Date() };
      const defaults = name === 'importJob'
        ? { status: 'queued', stopRequested: false, activeTitle: '', error: null, token: null, leaseExpiresAt: null, finishedAt: null, total: 0, processed: 0, created: 0, updated: 0, unpublished: 0, linked: 0, existing: 0, failed: 0 }
        : name === 'importJobItem' ? { status: 'queued', result: null, error: null } : { complexId: null, sourceId: null };
      const row = { ...common, ...defaults, ...clone(data) };
      tables[name].push(row); return clone(row);
    };
    replace(model, 'findMany', async (args: any) => find(args));
    replace(model, 'findFirst', async (args: any) => find(args)[0] || null);
    replace(model, 'findUnique', async (args: any) => find(args)[0] || null);
    replace(model, 'findUniqueOrThrow', async (args: any) => { const row = find(args)[0]; assert.ok(row); return row; });
    replace(model, 'count', async (args: any) => find(args).length);
    replace(model, 'create', async ({ data }: any) => create(data));
    replace(model, 'createMany', async ({ data, skipDuplicates }: any) => {
      let count = 0;
      for (const row of data) {
        if (skipDuplicates && tables[name].some(existing => existing.jobId === row.jobId && existing.key === row.key)) continue;
        create(row); count++;
      }
      return { count };
    });
    replace(model, 'update', async ({ where, data }: any) => {
      const row = tables[name].find(row => matches(row, where)); assert.ok(row); return clone(update(row, data));
    });
    replace(model, 'updateMany', async ({ where, data }: any) => {
      const rows = tables[name].filter(row => matches(row, where)); rows.forEach(row => update(row, data)); return { count: rows.length };
    });
    replace(model, 'deleteMany', async ({ where }: any) => {
      const removed = tables[name].filter(row => matches(row, where));
      tables[name] = tables[name].filter(row => !removed.includes(row));
      if (name === 'importJob') tables.importJobItem = tables.importJobItem.filter(item => !removed.some(job => job.id === item.jobId));
      return { count: removed.length };
    });
    replace(model, 'upsert', async ({ where, create: data, update: patch }: any) => {
      const row = tables[name].find(row => matches(row, where)); return row ? clone(update(row, patch)) : create(data);
    });
  }
  replace(db, '$executeRaw', async () => 1);
  replace(db, '$transaction', async (callback: any) => {
    const before = clone(tables);
    try { return await callback(db); }
    catch (error) { Object.assign(tables, before); throw error; }
  });
  return { tables, restore() { for (const [target, key, value] of original.reverse()) target[key] = value; } };
}

const apartment = (id: number, extra = {}) => ({ id, type: 'Квартиры - вторичное жильё', deal_type: 'sale',
  title: `Квартира ${id}`, city: 'Калининград', address: 'Тестовая улица, 1', apartment: '12',
  price: '9100000', params: { area: { value: '55.4' }, rooms: { value: '2' }, floor: { value: '3' } }, ...extra });

async function fixture() {
  const memory = memoryDatabase();
  const dir = await mkdtemp(join(tmpdir(), 'newh-job-test-'));
  const previousUploadDir = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = join(dir, 'uploads');
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Job tests must not access live feeds'); };
  const config: ImportConfig = { rf39FeedUrl: DEFAULT_RF39_FEED_URL, rf39SnapshotPath: join(dir, 'rf39.json'), nmarketSnapshotPath: join(dir, 'nmarket.xml'), nmarketFeedUrl: '' };
  const saveCrm = (items: any[]) => writeFile(config.rf39SnapshotPath, JSON.stringify({ version: 2,
    sourceHash: createHash('sha256').update(DEFAULT_RF39_FEED_URL).digest('hex'), snapshotDate: '2026-11-02T10:00:00.000Z',
    authoritative: true, presentIds: items.map(item => item.id), errors: [], items }));
  const drain = async () => { for (let i = 0; i < 100; i++) if (!await processNextImportJob(config)) return; throw new Error('Queue did not finish'); };
  return { ...memory, dir, config, saveCrm, drain, async close() {
    memory.restore(); globalThis.fetch = previousFetch;
    if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previousUploadDir;
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    await rm(dir, { recursive: true, force: true });
  } };
}

test('job input validates source IDs, count limits and unexpected fields', () => {
  const request = { requestId: randomUUID(), kind: 'import', source: 'rf39', items: [{ id: 1 }] };
  assert.equal(importJobRequestSchema.safeParse(request).success, true);
  for (const invalid of [ { ...request, source: 'nmarket' }, { ...request, items: [] }, { ...request, adminId: 'other' },
    { ...request, items: [{ id: -1 }] }, { ...request, items: [{ id: '1' }] }, { ...request, items: Array(10001).fill({ id: 1 }) } ])
    assert.equal(importJobRequestSchema.safeParse(invalid).success, false);
  assert.equal(importJobRequestSchema.safeParse({ ...request, source: 'nmarket', items: [{ id: 'apartment:123' }] }).success, true);
});

test('XML job details expose imported cards and failed offers without the internal plan', async () => {
  const f = await fixture();
  try {
    const job = await db.importJob.create({ data: { ownerId: 'owner', requestId: randomUUID(), kind: 'sync',
      request: { kind: 'sync', feedUrl: DEFAULT_RF39_FEED_URL }, updated: 2, unpublished: 1 } });
    await db.importJobItem.createMany({ data: [
      { jobId: job.id, key: 'feed-plan', kind: 'feed-plan', source: 'rf39', title: 'Plan', payload: {}, groupOrder: 0, step: -1 },
      { jobId: job.id, key: 'feed:rf39:1', kind: 'feed-import', source: 'rf39', title: 'Apartment',
        payload: { data: { sourceId: 'rf39:1' } }, result: { id: 'property-1', created: true, warnings: [] }, groupOrder: 0, step: 0 },
      { jobId: job.id, key: 'feed-error:0', kind: 'feed-error', source: 'rf39', title: 'Invalid offer',
        payload: { id: 2 }, status: 'failed', error: 'Invalid price', groupOrder: 0, step: 1 },
    ] });
    const view = await getImportJob('owner', job.id);
    assert.deepEqual([view.updated, view.unpublished], [2, 1]);
    assert.deepEqual(view.items?.map(item => [item.kind, item.sourceId, item.propertyId]), [
      ['import', 'rf39:1', 'property-1'], ['import', 2, undefined],
    ]);
    assert.equal(view.items?.[1]?.error, 'Invalid price');
    await db.importJob.update({ where: { id: job.id }, data: { status: 'failed', total: 0, processed: 0, failed: 0 } });
    assert.equal((await getImportJob('owner', job.id)).canRetry, true);
    await db.importJob.update({ where: { id: job.id }, data: { status: 'stopped' } });
    assert.equal((await getImportJob('owner', job.id)).canRetry, true);
  } finally { await f.close(); }
});

test('durable import resumes an expired claim, skips item errors and retries only failures under its owner', async () => {
  const f = await fixture();
  try {
    await f.saveCrm([apartment(1), apartment(2)]);
    const request = { requestId: randomUUID(), kind: 'import' as const, source: 'rf39' as const, snapshot: 'saved' as const,
      items: [1, 999, 2].map(id => ({ id, title: `Квартира ${id}` })) };
    const job = await createImportJob('owner', request);
    assert.equal((await createImportJob('owner', request)).id, job.id);
    assert.equal(f.tables.importJob.length, 1);
    assert.equal(await processNextImportJob(f.config), true);
    const running = f.tables.importJob[0];
    Object.assign(running, { status: 'running', token: 'expired-process', leaseExpiresAt: new Date(0) });
    f.tables.importJobItem[1].status = 'running';
    await f.drain();
    const result = await getImportJob('owner', job.id);
    assert.deepEqual([result.status, result.processed, result.created, result.failed], ['completed', 3, 2, 1]);
    assert.deepEqual(f.tables.property.map(row => row.sourceId), ['rf39:1', 'rf39:2']);
    assert.ok(result.items?.find(item => item.sourceId === 999)?.error);
    assert.deepEqual(await listImportJobs('other-owner'), []);
    await assert.rejects(getImportJob('other-owner', job.id), { statusCode: 404 });
    await assert.rejects(stopImportJob('other-owner', job.id), { statusCode: 404 });
    await f.saveCrm([apartment(1), apartment(2), apartment(999)]);
    const retry = await retryImportJob('owner', job.id, randomUUID());
    assert.equal(retry.total, 1);
    await f.drain();
    assert.equal((await getImportJob('owner', retry.id)).created, 1);
    assert.equal(f.tables.property.length, 3);
    assert.ok(f.tables.property.every(row => row.published === true && row.elite === true));
  } finally { await f.close(); }
});

test('queued stop is immediate and leaves every item available for retry', async () => {
  const f = await fixture();
  try {
    const job = await createImportJob('owner', { requestId: randomUUID(), kind: 'import', source: 'rf39', snapshot: 'saved', items: [{ id: 1 }, { id: 2 }] });
    const stopped = await stopImportJob('owner', job.id);
    assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.processed, 0);
    assert.equal(stopped.canRetry, true);
    assert.equal(await processNextImportJob(f.config), false);
    assert.equal(f.tables.property.length, 0);
    const retry = await retryImportJob('owner', job.id, randomUUID());
    assert.equal(retry.total, 2);
  } finally { await f.close(); }
});

test('only the owner can delete unclaimed terminal jobs and their history, keeping created properties', async () => {
  const f = await fixture();
  try {
    await f.saveCrm([apartment(1)]);
    const create = (ownerId = 'owner') => createImportJob(ownerId, { requestId: randomUUID(), kind: 'import', source: 'rf39', snapshot: 'saved', items: [{ id: 1 }] });
    const completed = await create();
    await f.drain();
    assert.equal((await getImportJob('owner', completed.id)).status, 'completed');
    const properties = structuredClone(f.tables.property);
    const aliases = structuredClone(f.tables.propertyImportSource);
    assert.equal(properties.length, 1);

    await assert.rejects(deleteImportJob('another-owner', completed.id), { statusCode: 404 });
    await assert.rejects(deleteImportJob('owner', 'missing-job'), { statusCode: 404 });
    const activeJob = await create();
    await assert.rejects(deleteImportJob('owner', activeJob.id), { statusCode: 409 });
    const activeRow = f.tables.importJob.find(job => job.id === activeJob.id);
    Object.assign(activeRow, { status: 'running', token: 'worker-token' });
    await assert.rejects(deleteImportJob('owner', activeJob.id), { statusCode: 409 });
    Object.assign(activeRow, { status: 'completed' });
    await assert.rejects(deleteImportJob('owner', activeJob.id), { statusCode: 409 });
    assert.ok(f.tables.importJobItem.some(item => item.jobId === activeJob.id));

    const stopped = await create();
    await stopImportJob('owner', stopped.id);
    const failed = await create();
    Object.assign(f.tables.importJob.find(job => job.id === failed.id), { status: 'failed', finishedAt: new Date() });
    for (const job of [completed, stopped, failed]) {
      assert.ok(f.tables.importJobItem.some(item => item.jobId === job.id));
      assert.deepEqual(await deleteImportJob('owner', job.id), { ok: true });
      assert.equal(f.tables.importJob.some(row => row.id === job.id), false);
      assert.equal(f.tables.importJobItem.some(item => item.jobId === job.id), false);
    }
    assert.ok(f.tables.importJob.some(job => job.id === activeJob.id));
    assert.deepEqual(f.tables.property, properties);
    assert.deepEqual(f.tables.propertyImportSource, aliases);
  } finally { await f.close(); }
});

test('unexpected errors preserve unfinished work for retry without starving later jobs', async () => {
  const f = await fixture();
  try {
    await f.saveCrm([apartment(1), apartment(2)]);
    const create = (id: number) => createImportJob('owner', { requestId: randomUUID(), kind: 'import', source: 'rf39', snapshot: 'saved', items: [{ id }] });
    const failed = await create(1), next = await create(2);
    const find = db.property.findMany;
    db.property.findMany = (async () => { throw new Error('Unexpected internal failure'); }) as any;
    await processNextImportJob(f.config);
    db.property.findMany = find;
    const result = await getImportJob('owner', failed.id);
    assert.deepEqual([result.status, result.processed, result.canRetry], ['failed', 0, true]);
    assert.ok(result.error && !result.error.includes('Unexpected internal failure'));
    assert.equal(result.items?.[0].status, 'running');
    await f.drain();
    assert.equal((await getImportJob('owner', next.id)).created, 1);
    assert.deepEqual(f.tables.property.map(row => row.sourceId), ['rf39:2']);
    const retry = await retryImportJob('owner', failed.id, randomUUID());
    await f.drain();
    assert.equal((await getImportJob('owner', retry.id)).created, 1);
  } finally { await f.close(); }
});

for (const loseOwnership of [false, true]) test(`in-flight import ${loseOwnership ? 'cannot commit after lease takeover' : 'finishes before manual stop and excludes a second worker'}`, async () => {
  const f = await fixture();
  try {
    await f.saveCrm([apartment(1, { images: ['/images/objects/job-test.png'] }), apartment(2)]);
    const image = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#75a2b3' } }).png().toBuffer();
    let release!: () => void, started!: () => void;
    const fetched = new Promise<void>(resolve => { started = resolve; });
    globalThis.fetch = async () => { started(); await new Promise<void>(resolve => { release = resolve; }); return new Response(image, { headers: { 'Content-Type': 'image/png' } }); };
    const job = await createImportJob('owner', { requestId: randomUUID(), kind: 'import', source: 'rf39', snapshot: 'saved', items: [{ id: 1 }, { id: 2 }] });
    const processing = processNextImportJob(f.config);
    await fetched;
    assert.equal(await processNextImportJob(f.config), false);
    if (loseOwnership) f.tables.importJob[0].token = 'replacement-process';
    else await stopImportJob('owner', job.id);
    release();
    if (loseOwnership) {
      await assert.rejects(processing, ImportOwnershipLost);
      assert.equal(f.tables.property.length, 0);
      assert.equal(f.tables.importJob[0].processed, 0);
      const cachedFile = `import-v1-${createHash('sha256').update(image).digest('hex')}.webp`;
      assert.deepEqual(await readdir(join(f.dir, 'uploads')), [cachedFile], JSON.stringify(f.tables.importJobItem));
      assert.equal(f.tables.importImageCache.length, 1);
      assert.equal(f.tables.importImageCache[0].originalFile, '/uploads/' + cachedFile);
      globalThis.fetch = async () => { throw new Error('Retry must reuse the cached image'); };
      f.tables.importJob[0].leaseExpiresAt = new Date(0);
      await f.drain();
      const resumed = await getImportJob('owner', job.id);
      assert.deepEqual([resumed.status, resumed.created, resumed.failed], ['completed', 2, 0]);
      assert.equal(f.tables.property[0].images.create[0].file, '/uploads/' + cachedFile);
    } else {
      await processing;
      const result = await getImportJob('owner', job.id);
      assert.deepEqual([result.status, result.processed, result.created, result.total], ['stopped', 1, 1, 2], JSON.stringify(result));
      assert.equal(await processNextImportJob(f.config), false);
      assert.equal(f.tables.property.length, 1);
      assert.equal(result.items?.[0]?.propertyId, f.tables.property[0].id);
    }
  } finally { await f.close(); }
});

for (const [preferredSource, failImage] of [['rf39', false], ['nmarket', false], ['rf39', true]] as const) test(`multiple complexes preserve ${preferredSource} preference after cache loss and continue past a removed complex (image failure: ${failImage})`, async () => {
  const f = await fixture();
  try {
    f.tables.property.push(...['a', 'b'].map((id, index) => ({ id, title: `ЖК ${id}`, type: 'complex', sourceId: null, complexId: null,
      location: 'Калининград', address: `Тестовая улица, ${index + 1}`, nmarketComplexId: String(7 + index), rf39ComplexId: String(7 + index) })));
    await f.saveCrm([0, 1].map(index => apartment(100 + index, { development: { id: 7 + index, title: `ЖК ${index ? 'b' : 'a'}` },
      complex: { id: 19 + index }, address: `Тестовая улица, ${index + 1}`,
      ...(failImage && index === 0 ? { images: ['/images/objects/unavailable.png'] } : {}) })));
    await writeFile(f.config.nmarketSnapshotPath, `<realty-feed xmlns="http://webmaster.yandex.ru/schemas/feed/realty/2010-06">${[0, 1].map(index => `<offer internal-id="${99 + index}">
      <type>продажа</type><property-type>жилая</property-type><category>квартира</category><nmarket-complex-id>${7 + index}</nmarket-complex-id><nmarket-building-id>${29 + index}</nmarket-building-id>
      <building-name>ЖК ${index ? 'b' : 'a'}</building-name><location><locality-name>Калининград</locality-name><address>Тестовая улица, ${index + 1}</address><apartment>12</apartment></location>
      <rooms>2</rooms><floor>3</floor><area><value>55.4</value><unit>кв. м</unit></area><price><value>9000000</value><currency>RUR</currency></price></offer>`).join('')}</realty-feed>`);
    const job = await createImportJob('owner', { requestId: randomUUID(), kind: 'apartments', complexIds: ['a', 'removed', 'b'], snapshot: 'saved', preferredSource });
    for (let i = 0; i < 100; i++) {
      if (!await processNextImportJob(f.config)) break;
      for (const id of ['a', 'b']) cacheApartmentMatches(id, true, new Map());
      for (const property of f.tables.property.filter(row => row.type === 'apartment')) {
        assert.ok(f.tables.importJobItem.filter(item => item.complexId === property.complexId && item.kind === 'search').every(item => item.status === 'completed'));
      }
    }
    const result = await getImportJob('owner', job.id);
    assert.equal(result.status, 'completed');
    assert.equal(result.created, 2);
    assert.equal(result.failed, 4);
    const apartments = f.tables.property.filter(row => row.type === 'apartment');
    assert.deepEqual(apartments.map(row => row.complexId), ['a', 'b']);
    assert.ok(apartments.every(row => row.sourceId.startsWith(preferredSource + ':') && row.published === (preferredSource === 'rf39') && row.elite === (preferredSource === 'rf39')));
    assert.equal(f.tables.propertyImportSource.length, 4);
    if (failImage) assert.ok(result.items?.some(item => item.warnings.some(warning => warning.includes('фотографию №1'))));
    assert.ok(f.tables.importJobItem.filter(item => item.kind === 'rescan' && item.complexId !== 'removed').every(item => item.status === 'completed'));
  } finally { await f.close(); }
});
