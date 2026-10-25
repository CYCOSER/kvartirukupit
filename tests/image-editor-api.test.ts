import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp, createRouter, toWebHandler } from 'h3';
import sharp from 'sharp';
import { Prisma } from '@prisma/client';
import type { ImageUpscale } from '@prisma/client';
import { editImage } from '../server/utils/image';
import { db } from '../server/utils/db';
import editor from '../server/api/admin/properties/[id]/images/[imageId]/editor.get';
import edit from '../server/api/admin/properties/[id]/images/[imageId]/edit.post';

async function fixture(t: TestContext, source?: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), 'newh-editor-'));
  const previousDir = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  t.after(async () => {
    if (previousDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  });
  const pixels = Buffer.from(Array.from({ length: 8 * 6 * 3 }, (_, index) => (index * 17) % 256));
  const original = source || await sharp(pixels, { raw: { width: 8, height: 6, channels: 3 } })
    .webp({ lossless: true, exact: true }).toBuffer();
  const originalFile = '/uploads/' + randomUUID() + '.webp';
  await writeFile(join(dir, basename(originalFile)), original);
  const image = { id: 'image', propertyId: 'property', file: originalFile, originalFile: null as string | null,
    alt: 'Photo', order: 0, kind: 'photo', hueShift: 0, crop: null as unknown, upscale: null as ImageUpscale | null };
  const matches = (where: Record<string, unknown>) => Object.entries(where).every(([key, value]) => image[key as keyof typeof image] === value);
  const previousMethods = { findFirst: db.propertyImage.findFirst, findFirstOrThrow: db.propertyImage.findFirstOrThrow,
    updateMany: db.propertyImage.updateMany };
  const previousTransaction = db.$transaction;
  t.after(() => { Object.assign(db.propertyImage, previousMethods); db.$transaction = previousTransaction; });
  db.propertyImage.findFirst = (async ({ where }: any) => matches(where) ? structuredClone(image) : null) as any;
  db.propertyImage.findFirstOrThrow = (async ({ where }: any) => {
    assert.ok(matches(where));
    return structuredClone(image);
  }) as any;
  db.propertyImage.updateMany = (async ({ where, data }: any) => {
    if (!matches(where)) return { count: 0 };
    Object.assign(image, data, { crop: data.crop === Prisma.DbNull ? null : data.crop });
    return { count: 1 };
  }) as any;
  const transaction = t.mock.fn(async (callback: any) => callback(db));
  db.$transaction = transaction as any;
  const app = createApp();
  app.use(createRouter()
    .get('/properties/:id/images/:imageId/editor', editor)
    .post('/properties/:id/images/:imageId/edit', edit));
  const handle = toWebHandler(app);
  const request = (method: 'GET' | 'POST', body?: unknown, propertyId = 'property') => handle(new Request(
    `http://localhost/properties/${propertyId}/images/image/${method === 'GET' ? 'editor' : 'edit'}`,
    { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) },
  ));
  const save = (changes = {}) => request('POST', { expectedFile: image.file, crop: null, hueShift: 0, ...changes });
  return { dir, image, original, originalFile, request, save, transaction };
}

test('Image editor reports oriented original dimensions and enforces property ownership', async t => {
  const source = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#e9c077' } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const f = await fixture(t, source);
  const response = await f.request('GET');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { file: f.originalFile, originalFile: f.originalFile, editFile: f.originalFile,
    width: 6, height: 8, hueShift: 0, crop: null, kind: 'photo',
    upscale: { status: null, error: null, available: process.env.UPSCALE_ENABLED === 'true' } });
  assert.equal((await f.request('GET', undefined, 'another-property')).status, 404);
  assert.equal((await f.request('POST', { expectedFile: f.image.file, hueShift: 0, crop: null }, 'another-property')).status, 404);
});

test('Image editor crops losslessly and every subsequent edit starts from the unchanged original', async t => {
  const f = await fixture(t);
  const crop = { left: 2, top: 1, width: 4, height: 3 };
  const response = await f.save({ crop });
  assert.equal(response.status, 200);
  const cropped = await response.json();
  assert.equal(cropped.originalFile, f.originalFile);
  assert.deepEqual(cropped.crop, crop);
  const output = await sharp(await readFile(join(f.dir, basename(cropped.file)))).raw().toBuffer({ resolveWithObject: true });
  assert.equal(output.info.width, crop.width);
  assert.equal(output.info.height, crop.height);
  assert.deepEqual(output.data, await sharp(f.original).extract(crop).raw().toBuffer());
  const metadata = await (await f.request('GET')).json();
  assert.equal(metadata.width, 8);
  assert.equal(metadata.height, 6);
  assert.deepEqual(metadata.crop, crop);

  assert.equal((await f.save({ hueShift: 90 })).status, 200);
  const restored = await f.save();
  assert.equal(restored.status, 200);
  const restoredImage = await restored.json();
  assert.equal(restoredImage.originalFile, f.originalFile);
  assert.equal(restoredImage.crop, null);
  assert.equal(restoredImage.hueShift, 0);
  assert.deepEqual(await sharp(await readFile(join(f.dir, basename(restoredImage.file)))).raw().toBuffer(),
    await sharp(f.original).raw().toBuffer());
  assert.deepEqual(await readFile(join(f.dir, basename(f.originalFile))), f.original);
});

test('Image editor rejects invalid edits, stale clients and unsafe source paths without creating files', async t => {
  const f = await fixture(t);
  const files = await readdir(f.dir);
  for (const changes of [
    { hueShift: 181 }, { hueShift: -181 }, { hueShift: 0.5 }, { extra: true },
    { crop: { left: -1, top: 0, width: 2, height: 2 } },
    { crop: { left: 0.5, top: 0, width: 2, height: 2 } },
    { crop: { left: 0, top: 0, width: 0, height: 2 } },
    { crop: { left: 7, top: 0, width: 2, height: 2 } },
    { crop: { left: 0, top: 5, width: 2, height: 2 } },
  ]) assert.equal((await f.save(changes)).status, 400, JSON.stringify(changes));
  assert.equal((await f.request('POST', { crop: null, hueShift: 0 })).status, 400);
  assert.equal((await f.save({ expectedFile: '/uploads/stale.webp' })).status, 409);
  assert.deepEqual(await readdir(f.dir), files);
  for (const path of ['/uploads/../private.webp', '/images//private.webp', '/images/../private.webp', 'https://example.com/image.webp']) {
    f.image.originalFile = path;
    assert.equal((await f.request('GET')).status, 400);
    assert.equal((await f.save()).status, 400);
  }
  assert.deepEqual(await readdir(f.dir), files);
});

test('Image editor removes an unsaved derived image if persistence fails', async t => {
  const f = await fixture(t);
  const files = await readdir(f.dir);
  f.transaction.mock.mockImplementation(async () => { throw new Error('Database unavailable'); });
  const response = await f.save({ crop: { left: 1, top: 1, width: 3, height: 3 } });
  assert.equal(response.status, 500);
  assert.equal(f.image.file, f.originalFile);
  assert.equal(f.image.originalFile, null);
  assert.deepEqual(await readdir(f.dir), files);
});

test('Saving unchanged crop and colour preserves an enhanced image and its original', async t => {
  const f = await fixture(t);
  f.image.originalFile = f.originalFile;
  f.image.file = '/uploads/' + randomUUID() + '.webp';
  await writeFile(join(f.dir, basename(f.image.file)), f.original);
  const enhancedFile = f.image.file;
  const files = await readdir(f.dir);
  const response = await f.save();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).file, enhancedFile);
  assert.equal(f.image.originalFile, f.originalFile);
  assert.deepEqual(await readdir(f.dir), files);
});

test('Enhanced photos use their new pixels and dimensions for edits and subsequent resets', async t => {
  const f = await fixture(t);
  const enhanced = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#557799' } })
    .webp({ lossless: true }).toBuffer();
  const enhancedFile = '/uploads/' + randomUUID() + '.webp';
  await writeFile(join(f.dir, basename(enhancedFile)), enhanced);
  Object.assign(f.image, { originalFile: f.originalFile, file: enhancedFile, hueShift: 25,
    crop: { left: 1, top: 1, width: 4, height: 3 },
    upscale: { imageId: f.image.id, sourceFile: f.originalFile, outputFile: enhancedFile,
      status: 'completed', mode: 'manual', error: null, token: null, attempts: 1, updatedAt: new Date() } });
  const metadata = await (await f.request('GET')).json();
  assert.equal(metadata.editFile, enhancedFile);
  assert.equal(metadata.originalFile, f.originalFile);
  assert.equal(metadata.width, 16);
  assert.equal(metadata.height, 12);
  assert.equal(metadata.crop, null);
  assert.equal(metadata.hueShift, 0);
  assert.equal((await f.save()).status, 200);
  assert.equal(f.image.file, enhancedFile);
  assert.equal(f.image.originalFile, f.originalFile);

  const crop = { left: 9, top: 7, width: 5, height: 4 };
  const response = await f.save({ crop, hueShift: 90 });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.originalFile, enhancedFile);
  const output = await readFile(join(f.dir, basename(saved.file)));
  assert.deepEqual(await sharp(output).raw().toBuffer(),
    await sharp(await editImage(enhanced, { crop, hueShift: 90 })).raw().toBuffer());
  const reopened = await (await f.request('GET')).json();
  assert.equal(reopened.editFile, enhancedFile);
  assert.deepEqual(reopened.crop, crop);
  assert.equal(reopened.hueShift, 90);
  assert.equal((await f.save()).status, 200);
  assert.deepEqual(await readFile(join(f.dir, basename(f.image.file))), enhanced);
  assert.deepEqual(await readFile(join(f.dir, basename(f.originalFile))), f.original);
});
