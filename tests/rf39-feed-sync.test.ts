import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../server/utils/db';
import { processRf39FeedJob } from '../server/utils/rf39-feed-sync';
import { rf39Draft } from '../server/utils/rf39-data';
import { rf39FeedBaseline } from '../shared/rf39-feed-merge';
import { ImportOwnershipLost, type ImportExecution } from '../server/utils/import-execution';

const clone = <T>(value: T): T => structuredClone(value);
const apartment = (id: number) => ({ id, type: 'Квартиры - вторичное жильё', deal_type: 'sale', city: 'Калининград',
  address: `Тестовая, ${id}`, price: '10000000', description: 'Описание квартиры из XML.', params: { area: { value: 50 }, rooms: { value: 2 } } });
const sourceDraft = (id: number) => rf39Draft(apartment(id), 'apartment');
const property = (id: number, extra: Record<string, unknown> = {}) => ({ ...sourceDraft(id).data, id: `property-${id}`, complexId: null,
  rf39Baseline: rf39FeedBaseline(sourceDraft(id).data), ...extra });

async function fixture(ids: number[], extraPlan = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'newh-feed-sync-'));
  const previousFetch = globalThis.fetch, previousDir = process.env.UPLOAD_DIR;
  const tables: Record<string, any[]> = { property: [], propertyImportSource: [], propertyImage: [], importJobItem: [], importJob: [], feedSyncSetting: [], importImageCache: [] };
  const originals: [any, string, any][] = [];
  const writes = { cardBatches: 0, afterCardBatch: (() => {}) as () => void };
  const replace = (target: any, key: string, value: any) => { originals.push([target, key, target[key]]); target[key] = value; };
  function matches(row: any, where: any = {}): boolean {
    return Object.entries(where).every(([key, value]: [string, any]) => {
      if (key === 'OR') return value.some((branch: any) => matches(row, branch));
      if (key === 'jobId_key') return matches(row, value);
      if (value === null || typeof value !== 'object' || value instanceof Date) return row[key] === value;
      return Object.entries(value).every(([op, wanted]: [string, any]) => {
        if (op === 'in') return wanted.includes(row[key]);
        if (op === 'notIn') return !wanted.includes(row[key]);
        if (op === 'startsWith') return typeof row[key] === 'string' && row[key].startsWith(wanted);
        if (op === 'not') return row[key] !== wanted;
        throw new Error(`Unsupported filter ${op}`);
      });
    });
  }
  function update(row: any, data: any) {
    for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value
      ? row[key] + value.increment : clone(value);
    return clone(row);
  }
  for (const [name] of Object.entries(tables)) {
    const model = (db as any)[name];
    function find(args: any = {}) {
      const rows = tables[name]!.filter(row => matches(row, args.where));
      const order = args.orderBy && Object.entries(args.orderBy)[0];
      if (order) rows.sort((a, b) => (a[order[0]] - b[order[0]]) * (order[1] === 'desc' ? -1 : 1));
      return rows.slice(0, args.take || rows.length).map(row => clone(args.include?.property ? { ...row,
        property: tables.property!.find(property => property.id === row.propertyId) } : row));
    }
    function create(data: any) {
      const unique = name === 'property' ? ['id', 'sourceId', 'slug'] : name === 'propertyImportSource' ? ['sourceId'] : ['id'];
      if (tables[name]!.some(row => unique.some(key => data[key] && row[key] === data[key])))
        throw Object.assign(new Error('Duplicate value'), { code: 'P2002' });
      const row = { id: randomUUID(), status: 'queued', result: null, error: null, ...clone(data) };
      tables[name]!.push(row); return clone(row);
    }
    replace(model, 'findMany', async (args: any) => find(args));
    replace(model, 'findUnique', async (args: any) => find(args)[0] || null);
    replace(model, 'findUniqueOrThrow', async (args: any) => { const row = find(args)[0]; assert.ok(row); return row; });
    replace(model, 'createMany', async ({ data, skipDuplicates }: any) => {
      let count = 0;
      for (const row of data) {
        if (skipDuplicates && tables[name]!.some(existing => existing.jobId === row.jobId && existing.key === row.key)) continue;
        create(row); count++;
      }
      if (name === 'property') { writes.cardBatches++; writes.afterCardBatch(); }
      return { count };
    });
    replace(model, 'update', async ({ where, data }: any) => { const row = tables[name]!.find(row => matches(row, where)); assert.ok(row); return update(row, data); });
    replace(model, 'updateMany', async ({ where, data }: any) => { const rows = tables[name]!.filter(row => matches(row, where)); rows.forEach(row => update(row, data)); return { count: rows.length }; });
    replace(model, 'upsert', async ({ where, create: data, update: patch }: any) => { const row = tables[name]!.find(row => matches(row, where)); return row ? update(row, patch) : create(data); });
  }
  replace(db, '$executeRaw', async () => 1);
  replace(db, '$transaction', async (callback: any) => {
    const before = clone(tables);
    try { return await callback(db); }
    catch (error) { Object.assign(tables, before); throw error; }
  });
  const job = { id: 'job', kind: 'sync', ownerId: 'admin', status: 'running', token: 'claim', stopRequested: false,
    request: { kind: 'sync', requestId: randomUUID(), feedUrl: 'https://feed.rf39.ru/30.xml' }, activeTitle: '', total: ids.length,
    processed: 0, created: 0, updated: 0, existing: 0, unpublished: 0, failed: 0, error: null };
  tables.importJob!.push(job);
  tables.feedSyncSetting!.push({ id: 'rf39', lastJobId: job.id, url: job.request.feedUrl, lastSuccessAt: null, lastError: null });
  tables.importJobItem!.push({ id: 'plan', jobId: job.id, key: 'feed-plan', kind: 'feed-plan', status: 'completed', payload: {},
    result: { presentIds: ids, authoritative: true, snapshotDate: new Date().toISOString(), fetchedAt: new Date().toISOString(), ...extraPlan } });
  ids.forEach((id, step) => tables.importJobItem!.push({ id: `work-${id}`, jobId: job.id, key: `feed:rf39:${id}`, kind: 'feed-import', source: 'rf39',
    title: `Квартира ${id}`, groupOrder: 0, step, status: 'queued', payload: JSON.parse(JSON.stringify(sourceDraft(id))), result: null }));
  const execution: ImportExecution = { guard: async () => {
    if (tables.importJob![0].status !== 'running' || tables.importJob![0].token !== 'claim') throw new ImportOwnershipLost();
  } };
  globalThis.fetch = async () => { throw new Error('A resumed feed job must not reload its snapshot'); };
  process.env.UPLOAD_DIR = join(dir, 'uploads');
  return { tables, job, writes, execution, config: { rf39SnapshotPath: join(dir, 'feed.json'), nmarketFeedUrl: '', nmarketSnapshotPath: '' },
    run: () => processRf39FeedJob(tables.importJob![0] as any, { rf39SnapshotPath: join(dir, 'feed.json'), nmarketFeedUrl: '', nmarketSnapshotPath: '' }, execution),
    async close() {
      for (const [target, key, value] of originals.reverse()) target[key] = value;
      globalThis.fetch = previousFetch;
      if (previousDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previousDir;
      await rm(dir, { recursive: true, force: true });
    } };
}

test('feed sync publishes aliases without replacing primary data and removes only absent primary CRM cards', async () => {
  const f = await fixture([1, 2, 3, 4]);
  try {
    f.tables.property!.push(property(1, { title: 'Ручной заголовок', slug: 'rf39-1', price: 9000000, rf39Baseline: rf39FeedBaseline({ ...sourceDraft(1).data, price: 9000000 }), published: false, elite: false }),
      property(4, { sourceId: 'nmarket:apartment:4', sourceMode: 'nmarket-copy', title: 'Ручное название Nmarket', price: 7000000, published: false, elite: false }),
      property(99), property(98, { sourceId: 'rf39-layout:1:98' }), property(97, { sourceId: 'nmarket:apartment:97' }));
    f.tables.propertyImportSource!.push({ sourceId: 'rf39:4', propertyId: 'property-4' });
    f.tables.propertyImage!.push({ id: 'manual-photo', propertyId: 'property-1', file: '/uploads/manual.webp', order: 0 });
    f.tables.importJobItem!.find(row => row.id === 'work-2').payload.data.slug = 'rf39-2';
    await f.run();
    const current = f.tables.property!.find(row => row.id === 'property-1');
    assert.equal(current.title, 'Ручной заголовок');
    assert.equal(current.slug, 'rf39-1');
    assert.equal(f.tables.property!.find(row => row.sourceId === 'rf39:2').slug, 'robj-2');
    assert.equal(current.price, 10000000);
    assert.equal(current.elite, true);
    assert.equal(current.published, true);
    assert.equal(f.tables.propertyImage![0].file, '/uploads/manual.webp');
    const alias = f.tables.property!.find(row => row.id === 'property-4');
    assert.equal(alias.published, true);
    assert.equal(alias.elite, true);
    assert.equal(alias.title, 'Ручное название Nmarket');
    assert.equal(alias.price, 7000000);
    assert.equal(alias.sourceId, 'nmarket:apartment:4');
    assert.equal(alias.sourceMode, 'nmarket-copy');
    assert.equal(f.tables.property!.find(row => row.id === 'property-99').published, false);
    assert.equal(f.tables.property!.find(row => row.id === 'property-98').published, true);
    assert.equal(f.tables.property!.find(row => row.id === 'property-97').published, true);
    const job = f.tables.importJob![0];
    assert.deepEqual([job.status, job.created, job.updated, job.existing, job.processed, job.unpublished], ['completed', 2, 2, 0, 4, 1]);
    assert.equal(f.writes.cardBatches, 1);
    assert.ok(f.tables.feedSyncSetting![0].lastSuccessAt instanceof Date);
  } finally { await f.close(); }
});

test('a CRM alias linked to a complex is a conflict and cannot publish the complex as an elite apartment', async () => {
  const f = await fixture([1, 2]);
  try {
    f.tables.property!.push(property(1, { sourceId: 'nmarket:complex:1', type: 'complex', housingMarket: null, published: false, elite: false }));
    f.tables.propertyImportSource!.push({ sourceId: 'rf39:1', propertyId: 'property-1' });
    await f.run();
    const complex = f.tables.property!.find(row => row.id === 'property-1');
    assert.deepEqual([complex.type, complex.published, complex.elite], ['complex', false, false]);
    assert.deepEqual([f.tables.importJob![0].created, f.tables.importJob![0].failed], [1, 1]);
    assert.match(f.tables.importJobItem!.find(row => row.id === 'work-1').error, /изменён вручную/);
  } finally { await f.close(); }
});

test('absence cleanup locks feed settings before reading the URL and retains the lock through the transaction', async () => {
  const f = await fixture([1]);
  const executeRaw = db.$executeRaw, findSetting = db.feedSyncSetting.findUnique, updateProperties = db.property.updateMany;
  let locked = false, readUnderLock = false;
  try {
    f.tables.property!.push(property(99));
    db.$executeRaw = (async (query: TemplateStringsArray) => {
      if (query.join('').includes('rf39-feed-schedule')) locked = true;
      return 1;
    }) as any;
    db.feedSyncSetting.findUnique = (async (args: any) => { assert.equal(locked, true); readUnderLock = true; return findSetting(args); }) as any;
    db.property.updateMany = (async (args: any) => { if (args.data.published === false) assert.equal(locked, true); return updateProperties(args); }) as any;
    await f.run();
    assert.equal(readUnderLock, true);
    assert.equal(f.tables.importJob![0].unpublished, 1);
  } finally {
    db.$executeRaw = executeRaw; db.feedSyncSetting.findUnique = findSetting; db.property.updateMany = updateProperties;
    await f.close();
  }
});

test('one manual type conflict falls back per item and prevents absence cleanup without stopping valid cards', async () => {
  const f = await fixture([1, 2, 3]);
  try {
    f.tables.property!.push(property(2, { type: 'complex', housingMarket: null, elite: false }), property(99));
    await f.run();
    const job = f.tables.importJob![0];
    assert.deepEqual([job.status, job.created, job.failed, job.processed, job.unpublished], ['completed', 2, 1, 3, 0]);
    assert.equal(f.tables.property!.find(row => row.sourceId === 'rf39:2').type, 'complex');
    assert.equal(f.tables.property!.find(row => row.sourceId === 'rf39:99').published, true);
    assert.match(job.error, /не снимались/);
    assert.equal(f.tables.feedSyncSetting![0].lastSuccessAt, null);
    assert.match(f.tables.importJobItem!.find(row => row.id === 'work-2').error, /изменён вручную/);
  } finally { await f.close(); }
});

test('a card deleted after prefetch is skipped instead of recreated without prepared photos', async () => {
  const f = await fixture([1, 2]);
  const findMany = db.property.findMany;
  try {
    f.tables.property!.push(property(1), property(99));
    let removed = false;
    db.property.findMany = (async (args: any) => {
      const rows = await findMany(args);
      if (!removed && args.where?.sourceId?.in) {
        removed = true;
        f.tables.property = f.tables.property!.filter(row => row.id !== 'property-1');
      }
      return rows;
    }) as any;
    await f.run();
    assert.equal(f.tables.property!.some(row => row.sourceId === 'rf39:1'), false);
    assert.equal(f.tables.property!.some(row => row.sourceId === 'rf39:2'), true);
    assert.match(f.tables.importJobItem!.find(row => row.id === 'work-1').error, /удалена/);
    assert.deepEqual([f.tables.importJob![0].created, f.tables.importJob![0].failed, f.tables.importJob![0].unpublished], [1, 1, 0]);
  } finally { db.property.findMany = findMany; await f.close(); }
});

test('a PostgreSQL check violation skips only its card while an infrastructure failure stops the job', async () => {
  for (const code of ['23514', '08006']) {
    const f = await fixture([1, 2]);
    const createMany = db.property.createMany;
    try {
      db.property.createMany = (async (args: any) => {
        if (args.data.some((row: any) => row.sourceId === 'rf39:1'))
          throw Object.assign(new Error(`QueryError(PostgresError { code: "${code}", message: "test" })`), { name: 'PrismaClientUnknownRequestError' });
        return createMany(args);
      }) as any;
      if (code === '23514') {
        await f.run();
        assert.equal(f.tables.property!.some(row => row.sourceId === 'rf39:2'), true);
        assert.deepEqual([f.tables.importJob![0].created, f.tables.importJob![0].failed], [1, 1]);
      } else {
        await assert.rejects(f.run(), /08006/);
        assert.equal(f.tables.property!.length, 0);
      }
    } finally { db.property.createMany = createMany; await f.close(); }
  }
});

test('stop after a committed batch preserves remaining work and resume does not refetch or duplicate cards', async () => {
  const f = await fixture(Array.from({ length: 26 }, (_, index) => index + 1));
  try {
    f.tables.property!.push(property(99));
    f.writes.afterCardBatch = () => { f.tables.importJob![0].stopRequested = true; };
    await f.run();
    assert.equal(f.tables.importJob![0].status, 'stopped');
    assert.equal(f.tables.importJob![0].created, 25);
    assert.equal(f.tables.property!.find(row => row.sourceId === 'rf39:99').published, true);
    f.writes.afterCardBatch = () => {};
    Object.assign(f.tables.importJob![0], { status: 'running', token: 'claim', stopRequested: false });
    await f.run();
    assert.equal(f.tables.importJob![0].status, 'completed');
    assert.equal(f.tables.importJob![0].created, 26);
    assert.equal(f.tables.importJob![0].processed, 26);
    assert.equal(new Set(f.tables.property!.map(row => row.sourceId)).size, 27);
    assert.equal(f.tables.importJob![0].unpublished, 1);
  } finally { await f.close(); }
});

for (const reason of ['ambiguous', 'settings', 'ownership']) test(`feed safety guard: ${reason} never unpublishes absent cards`, async () => {
  const f = await fixture([1], reason === 'ambiguous' ? { authoritative: false } : {});
  try {
    f.tables.property!.push(property(99));
    if (reason === 'settings') f.tables.feedSyncSetting![0].url = 'https://feed.rf39.ru/31.xml';
    if (reason === 'ownership') {
      let guards = 0;
      f.execution.guard = async () => { if (++guards === 3) throw new ImportOwnershipLost(); };
      await assert.rejects(f.run(), ImportOwnershipLost);
      assert.equal(f.tables.property!.length, 1);
    } else {
      await f.run();
      assert.equal(f.tables.importJob![0].created, 1);
      assert.match(f.tables.importJob![0].error, /не снимались/);
    }
    assert.equal(f.tables.property!.find(row => row.sourceId === 'rf39:99').published, true);
    assert.equal(f.tables.feedSyncSetting![0].lastSuccessAt, null);
  } finally { await f.close(); }
});

test('validated XML is checkpointed once, unsupported objects are ignored and malformed records remain visible as failures', async () => {
  const f = await fixture([]);
  try {
    Object.assign(f.tables.importJobItem![0], { status: 'queued', result: null });
    f.tables.property!.push(property(99));
    const offer = (id: number, category = 'квартира', extra = '') => `<offer internal-id="id-${id}"><url>https://rf39.ru/catalog/sale/flat/object/${id}/</url><type>продажа</type><property-type>жилая</property-type><category>${category}</category><location><locality-name>Калининград</locality-name><address>Тестовая</address></location><price><value>5000000</value><currency>RUR</currency></price><area><value>50</value><unit>кв. м</unit></area><rooms>2</rooms>${extra}</offer>`;
    globalThis.fetch = async () => new Response(`<realty-feed xmlns="http://webmaster.yandex.ru/schemas/feed/realty/2010-06">${offer(1)}${offer(2, 'дом')}${offer(3, 'квартира', '<rooms>3</rooms>')}</realty-feed>`);
    await f.run();
    const job = f.tables.importJob![0];
    assert.deepEqual([job.created, job.failed, job.total, job.processed, job.unpublished], [1, 1, 2, 2, 0]);
    assert.equal(f.tables.importJobItem![0].status, 'completed');
    assert.deepEqual(f.tables.importJobItem![0].result.presentIds, [1, 2, 3]);
    assert.equal(f.tables.property!.find(row => row.sourceId === 'rf39:99').published, true);
    assert.equal(f.tables.property!.some(row => row.sourceId === 'rf39:2'), false);
  } finally { await f.close(); }
});
