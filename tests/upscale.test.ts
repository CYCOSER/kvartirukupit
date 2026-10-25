import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp, createRouter, toWebHandler } from 'h3';
import sharp from 'sharp';
import { db } from '../server/utils/db';
import { discoverHeroUpscales, needsFullHd, processNextUpscale, queueUpscale, recoverUpscales, upscaleState } from '../server/utils/upscale';
import getUpscale from '../server/api/admin/properties/[id]/images/[imageId]/upscale.get';
import postUpscale from '../server/api/admin/properties/[id]/images/[imageId]/upscale.post';
import revertUpscale from '../server/api/admin/properties/[id]/images/[imageId]/upscale-revert.post';

function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (value instanceof Date) return row[key]?.getTime() === value.getTime();
    if (value && typeof value === 'object') {
      if ('not' in value) return row[key] !== value.not;
      if ('lt' in value) return row[key] < value.lt;
    }
    return row[key] === value;
  });
}

async function fixture(t: TestContext, width = 8, height = 6) {
  const dir = await mkdtemp(join(tmpdir(), 'newh-upscale-'));
  const oldDir = process.env.UPLOAD_DIR;
  const oldEnabled = process.env.UPSCALE_ENABLED;
  process.env.UPLOAD_DIR = dir;
  process.env.UPSCALE_ENABLED = 'true';
  t.after(async () => {
    if (oldDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = oldDir;
    if (oldEnabled === undefined) delete process.env.UPSCALE_ENABLED; else process.env.UPSCALE_ENABLED = oldEnabled;
    await rm(dir, { recursive: true, force: true });
  });
  const source = await sharp({ create: { width, height, channels: 3, background: '#b6c3d0' } }).webp({ lossless: true }).toBuffer();
  const sourceFile = '/uploads/' + randomUUID() + '.webp';
  await writeFile(join(dir, basename(sourceFile)), source);
  const image: any = { id: 'photo', propertyId: 'property', file: sourceFile, originalFile: null, crop: null,
    hueShift: 0, kind: 'photo', order: 1, alt: 'Photo' };
  const images = [image];
  const jobs = new Map<string, any>();
  let clock = Date.now();
  const assignJob = (row: any, data: any) => {
    for (const [key, value] of Object.entries(data) as [string, any][]) {
      row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value;
    }
    row.updatedAt = new Date(++clock);
    return row;
  };
  const findImage = (where: any) => images.filter(row => matches(row, where)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))[0];
  const method = (object: any, name: string, implementation: any) => {
    const previous = object[name];
    const mock = t.mock.fn(implementation);
    object[name] = mock;
    t.after(() => { object[name] = previous; });
    return mock;
  };
  method(db.propertyImage, 'findFirst', async ({ where, include }: any) => {
    const row = findImage(where);
    return row ? structuredClone({ ...row, ...(include?.upscale ? { upscale: jobs.get(row.id) || null } : {}) }) : null;
  });
  method(db.propertyImage, 'findFirstOrThrow', async ({ where }: any) => {
    const row = findImage(where);
    assert.ok(row);
    return structuredClone(row);
  });
  method(db.propertyImage, 'updateMany', async ({ where, data }: any) => {
    const row = findImage(where);
    if (!row) return { count: 0 };
    Object.assign(row, data);
    return { count: 1 };
  });
  const discover = method(db.property, 'findMany', async (query: any) => {
    assert.deepEqual(query.select.images, { where: { kind: { not: 'plan' } }, orderBy: [{ order: 'asc' }, { id: 'asc' }], take: 1 });
    return [{ images: images.filter(row => row.kind !== 'plan').sort((a, b) => a.order - b.order).slice(0, 1) }];
  });
  method(db.imageUpscale, 'findUnique', async ({ where }: any) => structuredClone(jobs.get(where.imageId) || null));
  method(db.imageUpscale, 'findUniqueOrThrow', async ({ where }: any) => {
    assert.ok(jobs.has(where.imageId));
    return structuredClone(jobs.get(where.imageId));
  });
  method(db.imageUpscale, 'create', async ({ data }: any) => {
    if (jobs.has(data.imageId)) throw Object.assign(new Error('Duplicate'), { code: 'P2002' });
    const row = assignJob({ attempts: 0, error: null, outputFile: null, token: null }, data);
    jobs.set(data.imageId, row);
    return structuredClone(row);
  });
  method(db.imageUpscale, 'findFirst', async ({ where }: any) => {
    const row = [...jobs.values()].find(row => matches(row, where));
    return row ? structuredClone({ ...row, image: images.find(image => image.id === row.imageId) }) : null;
  });
  const updateJobs = method(db.imageUpscale, 'updateMany', async ({ where, data }: any) => {
    const rows = [...jobs.values()].filter(row => matches(row, where));
    rows.forEach(row => assignJob(row, data));
    return { count: rows.length };
  });
  method(db.imageUpscale, 'update', async ({ where, data }: any) => {
    const row = jobs.get(where.imageId);
    assert.ok(row);
    return structuredClone(assignJob(row, data));
  });
  method(db.imageUpscale, 'deleteMany', async ({ where }: any) => {
    const rows = [...jobs.values()].filter(row => matches(row, where));
    rows.forEach(row => jobs.delete(row.imageId));
    return { count: rows.length };
  });
  method(db, '$transaction', async (callback: any) => callback(db));
  const output = await sharp(source).resize(Math.min(width * 2, 64), Math.min(height * 2, 64)).webp().toBuffer();
  const worker = method(globalThis, 'fetch', async (url: string, options: any) => {
    assert.equal(url, 'http://upscale:8080/upscale');
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'POST');
    assert.deepEqual(Buffer.from(options.body), source);
    return new Response(new Uint8Array(output), { headers: { 'Content-Type': 'image/webp' } });
  });
  method(console, 'error', () => {});
  const handle = toWebHandler(createApp().use(createRouter()
    .get('/properties/:id/images/:imageId/upscale', getUpscale)
    .post('/properties/:id/images/:imageId/upscale', postUpscale)
    .post('/properties/:id/images/:imageId/upscale-revert', revertUpscale)));
  const request = (method: string, body?: any, propertyId = 'property', imageId = 'photo', action = 'upscale') => handle(new Request(
    `http://localhost/properties/${propertyId}/images/${imageId}/${action}`, {
      method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    }));
  const revert = (body = { expectedFile: image.file }, propertyId = 'property') => request('POST', body, propertyId, 'photo', 'upscale-revert');
  return { dir, image, images, jobs, source, sourceFile, output, worker, discover, updateJobs, request, revert };
}

test('Full HD threshold preserves orientation and checks both image edges', () => {
  for (const [width, height, expected] of [[1920, 1080, false], [1080, 1920, false], [2048, 1536, false],
    [1919, 1080, true], [1920, 1079, true], [800, 600, true], [3000, 700, true]] as const)
    assert.equal(needsFullHd(width, height), expected, `${width}x${height}`);
});

test('Discovery chooses first photograph, excludes plans and avoids duplicate queued work', async t => {
  const f = await fixture(t);
  f.images.push({ ...f.image, id: 'plan', order: 0, kind: 'plan' }, { ...f.image, id: 'second', order: 2 });
  await discoverHeroUpscales();
  await discoverHeroUpscales();
  assert.equal(f.discover.mock.callCount(), 2);
  assert.deepEqual([...f.jobs.keys()], ['photo']);
  assert.equal(f.jobs.get('photo').mode, 'auto');
  assert.equal(f.jobs.get('photo').status, 'queued');
  assert.equal(f.worker.mock.callCount(), 0);
});

test('Full HD sources are skipped automatically but can be queued manually', async t => {
  const f = await fixture(t, 1920, 1080);
  assert.equal((await queueUpscale(f.image, 'auto')).status, 'skipped');
  assert.equal(upscaleState({ ...f.image, upscale: f.jobs.get('photo') }).status, null);
  assert.equal((await queueUpscale(f.image, 'manual')).status, 'queued');
});

test('Manual API validates request, property ownership, file version and configured availability', async t => {
  const f = await fixture(t);
  for (const body of [{}, { expectedFile: '' }, { expectedFile: f.sourceFile, extra: true }])
    assert.equal((await f.request('POST', body)).status, 400);
  assert.equal((await f.request('POST', { expectedFile: f.sourceFile }, 'other')).status, 404);
  assert.equal((await f.request('GET', undefined, 'other')).status, 404);
  assert.equal((await f.request('POST', { expectedFile: '/uploads/stale.webp' })).status, 409);
  process.env.UPSCALE_ENABLED = 'false';
  assert.equal((await f.request('POST', { expectedFile: f.sourceFile })).status, 503);
  process.env.UPSCALE_ENABLED = 'true';
  const response = await f.request('POST', { expectedFile: f.sourceFile });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'queued' });
  assert.deepEqual(await (await f.request('GET')).json(), { status: 'queued', error: null, available: true, file: f.sourceFile });
  assert.equal(f.worker.mock.callCount(), 0);
});

test('Manual requests reject oversize inputs and images already at the output size limit', async t => {
  for (const [width, height] of [[3000, 2700], [4096, 100]] as const) await t.test(`${width}x${height}`, async t => {
    const f = await fixture(t, width, height);
    const response = await f.request('POST', { expectedFile: f.sourceFile });
    assert.equal(response.status, 400);
    assert.equal(f.jobs.size, 0);
    assert.equal(f.worker.mock.callCount(), 0);
    if (width === 4096) assert.equal((await queueUpscale(f.image, 'auto')).status, 'skipped');
  });
});

test('Worker updates saved file, preserves original and edits, and never chains repeated upscaling', async t => {
  const f = await fixture(t);
  f.image.originalFile = '/uploads/' + randomUUID() + '.webp';
  const crop = { left: 2, top: 3, width: 8, height: 6 };
  f.image.crop = crop;
  f.image.hueShift = 35;
  const originalFile = f.image.originalFile;
  await queueUpscale(f.image, 'auto');
  assert.equal(await processNextUpscale(), true);
  assert.notEqual(f.image.file, f.sourceFile);
  assert.equal(f.image.originalFile, originalFile);
  assert.deepEqual(f.image.crop, crop);
  assert.equal(f.image.hueShift, 35);
  assert.deepEqual(await readFile(join(f.dir, basename(f.sourceFile))), f.source);
  assert.deepEqual(await readFile(join(f.dir, basename(f.image.file))), f.output);
  assert.equal(f.jobs.get('photo').status, 'completed');
  assert.equal((await queueUpscale(f.image, 'auto')).status, 'completed');
  assert.equal((await queueUpscale(f.image, 'manual')).status, 'completed');
  assert.equal(await processNextUpscale(), false);
  assert.equal(f.worker.mock.callCount(), 1);
});

test('A manually enhanced small photo gets a Full HD job when it becomes the hero', async t => {
  const f = await fixture(t);
  await queueUpscale(f.image, 'manual');
  await processNextUpscale();
  assert.equal(f.jobs.get('photo').status, 'completed');
  assert.equal((await queueUpscale(f.image, 'auto')).status, 'queued');
  assert.equal(f.jobs.get('photo').mode, 'auto');
  assert.equal(f.jobs.get('photo').sourceFile, f.image.file);
  assert.equal(f.jobs.get('photo').attempts, 0);
});

test('Reverting enhancement restores the saved crop and colour version, preserves both files and opts out of automatic retry', async t => {
  const f = await fixture(t);
  f.image.originalFile = '/uploads/' + randomUUID() + '.webp';
  f.image.crop = { left: 1, top: 2, width: 8, height: 6 };
  f.image.hueShift = 25;
  const originalFile = f.image.originalFile;
  await queueUpscale(f.image, 'auto');
  await processNextUpscale();
  const improvedFile = f.image.file;
  process.env.UPSCALE_ENABLED = 'false';
  const response = await f.revert();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).file, f.sourceFile);
  assert.equal(f.image.originalFile, originalFile);
  assert.deepEqual(f.image.crop, { left: 1, top: 2, width: 8, height: 6 });
  assert.equal(f.image.hueShift, 25);
  assert.equal(upscaleState({ ...f.image, upscale: f.jobs.get('photo') }).status, 'reverted');
  await discoverHeroUpscales();
  assert.equal(f.jobs.get('photo').status, 'reverted');
  assert.deepEqual(await readFile(join(f.dir, basename(f.sourceFile))), f.source);
  assert.deepEqual(await readFile(join(f.dir, basename(improvedFile))), f.output);
  process.env.UPSCALE_ENABLED = 'true';
  assert.equal((await queueUpscale(f.image, 'manual')).status, 'queued');
});

test('Rollback rejects invalid bodies, wrong property, stale versions and lost job claims', async t => {
  const f = await fixture(t);
  assert.equal((await f.revert({} as any)).status, 400);
  assert.equal((await f.revert({ expectedFile: f.sourceFile }, 'other')).status, 404);
  assert.equal((await f.revert()).status, 409);
  await queueUpscale(f.image, 'auto');
  await processNextUpscale();
  const improvedFile = f.image.file;
  assert.equal((await f.revert({ expectedFile: f.sourceFile })).status, 409);
  f.updateJobs.mock.mockImplementation(async () => ({ count: 0 }));
  assert.equal((await f.revert()).status, 409);
  assert.equal(f.image.file, improvedFile);
  assert.equal(f.jobs.get('photo').status, 'completed');
});

test('Reset to a low resolution pre-upscale source queues a fresh automatic enhancement', async t => {
  const f = await fixture(t);
  await queueUpscale(f.image, 'auto');
  await processNextUpscale();
  f.image.file = f.sourceFile;
  assert.notEqual(upscaleState({ ...f.image, upscale: f.jobs.get('photo') }).status, 'completed');
  assert.equal((await queueUpscale(f.image, 'auto')).status, 'queued');
});

test('Concurrent image changes or deletion discard worker output without overwriting edits', async t => {
  for (const mutation of ['edit', 'delete', 'kind'] as const) await t.test(mutation, async t => {
    const f = await fixture(t);
    const files = await readdir(f.dir);
    await queueUpscale(f.image, 'auto');
    f.worker.mock.mockImplementation(async () => {
      if (mutation === 'edit') f.image.file = '/uploads/later-edit.webp';
      if (mutation === 'kind') f.image.kind = 'plan';
      if (mutation === 'delete') { f.images.length = 0; f.jobs.clear(); }
      return new Response(new Uint8Array(f.output));
    });
    await processNextUpscale();
    assert.deepEqual(await readdir(f.dir), files);
    if (mutation === 'edit') assert.equal(f.image.file, '/uploads/later-edit.webp');
    if (mutation === 'kind') assert.equal(f.image.file, f.sourceFile);
    if (mutation === 'delete') assert.equal(f.jobs.size, 0);
  });
});

test('Reordering during automatic inference discards output but permits enhancement if hero returns', async t => {
  const f = await fixture(t);
  const second = { ...f.image, id: 'second', order: 2 };
  f.images.push(second);
  const files = await readdir(f.dir);
  await queueUpscale(f.image, 'auto');
  f.worker.mock.mockImplementation(async () => {
    second.order = 0;
    return new Response(new Uint8Array(f.output));
  });
  await processNextUpscale();
  assert.equal(f.image.file, f.sourceFile);
  assert.deepEqual(await readdir(f.dir), files);
  second.order = 2;
  await discoverHeroUpscales();
  assert.equal(f.jobs.get('photo').status, 'queued');
});

test('An expired worker cannot apply output after another worker replaces its claim', async t => {
  const f = await fixture(t);
  const files = await readdir(f.dir);
  await queueUpscale(f.image, 'manual');
  f.worker.mock.mockImplementation(async () => {
    f.jobs.get('photo').token = 'new-worker';
    return new Response(new Uint8Array(f.output));
  });
  await processNextUpscale();
  assert.equal(f.image.file, f.sourceFile);
  assert.equal(f.jobs.get('photo').token, 'new-worker');
  assert.deepEqual(await readdir(f.dir), files);
});

test('Invalid worker image fails safely before writing a derivative', async t => {
  const f = await fixture(t);
  await queueUpscale(f.image, 'manual');
  f.worker.mock.mockImplementation(async () => new Response('not an image'));
  await processNextUpscale();
  assert.equal(f.jobs.get('photo').status, 'failed');
  assert.equal(f.image.file, f.sourceFile);
  assert.deepEqual(await readdir(f.dir), [basename(f.sourceFile)]);
});

test('Failed inference preserves files and automatic retries are delayed and bounded', async t => {
  const f = await fixture(t);
  await queueUpscale(f.image, 'auto');
  f.worker.mock.mockImplementation(async () => new Response('unavailable', { status: 503 }));
  await processNextUpscale();
  const job = f.jobs.get('photo');
  assert.equal(job.status, 'failed');
  assert.equal(job.attempts, 1);
  assert.equal(f.image.file, f.sourceFile);
  assert.deepEqual(await readdir(f.dir), [basename(f.sourceFile)]);
  assert.equal((await queueUpscale(f.image, 'auto')).status, 'failed');
  job.updatedAt = new Date(Date.now() - 61000);
  assert.equal((await queueUpscale(f.image, 'auto')).status, 'queued');
  Object.assign(job, { status: 'failed', attempts: 3, updatedAt: new Date(Date.now() - 61000) });
  assert.equal((await queueUpscale(f.image, 'auto')).status, 'failed');
  assert.equal((await queueUpscale(f.image, 'manual')).status, 'queued');
  assert.equal(job.attempts, 0);
});

test('Only the worker owning a queue claim calls inference and expired leases recover', async t => {
  const f = await fixture(t);
  await queueUpscale(f.image, 'auto');
  f.updateJobs.mock.mockImplementationOnce(async () => ({ count: 0 }));
  await processNextUpscale();
  assert.equal(f.worker.mock.callCount(), 0);
  const job = f.jobs.get('photo');
  Object.assign(job, { status: 'processing', token: 'old-claim', updatedAt: new Date(Date.now() - 16 * 60000) });
  await recoverUpscales();
  assert.equal(job.status, 'queued');
  assert.equal(job.token, null);
  Object.assign(job, { status: 'processing', token: 'active-claim', updatedAt: new Date() });
  await recoverUpscales();
  assert.equal(job.status, 'processing');
  assert.equal(job.token, 'active-claim');
});
