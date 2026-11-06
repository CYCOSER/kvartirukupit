import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { db } from '../server/utils/db';
import { imageFingerprint, propertyImageFingerprint, propertyPhotoFingerprint, samePhoto } from '../server/utils/image-fingerprint';
import { mockImageFingerprintCache } from './fixtures/image-fingerprint-cache';
import { detailedPhoto } from './fixtures/photo';

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'newh-photo-fingerprint-'));
  const previousDir = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  const cache = mockImageFingerprintCache();
  t.after(async () => {
    cache.restore();
    if (previousDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  });
  async function file(bytes: Buffer) {
    const name = randomUUID() + '.webp';
    await writeFile(join(dir, name), bytes);
    return { file: '/uploads/' + name, path: join(dir, name) };
  }
  return { file, cache };
}

test('photo comparison recognizes resized JPEG copies while exact fingerprints remain different', async t => {
  const f = await fixture(t), source = await detailedPhoto();
  const first = await f.file(source), copy = await f.file(await sharp(source).resize(320, 240).jpeg({ quality: 72 }).toBuffer());
  const original = await propertyPhotoFingerprint(first.file), resized = await propertyPhotoFingerprint(copy.file);
  assert.ok(original); assert.ok(resized);
  assert.deepEqual([original.width, original.height], [640, 480]);
  assert.equal(samePhoto(original, resized), true);
  assert.notEqual(await propertyImageFingerprint(first.file), await propertyImageFingerprint(copy.file));
  assert.equal(await propertyImageFingerprint(first.file), await imageFingerprint(source));
  assert.ok(f.cache.rows.has(first.file));
  assert.ok(f.cache.rows.has(`photo-v1:${first.file}`));
});

test('photo comparison preserves crops, colour edits, different scenes and incompatible proportions', async t => {
  const f = await fixture(t), source = await detailedPhoto();
  const original = await propertyPhotoFingerprint((await f.file(source)).file);
  const variants = [
    await sharp(source).extract({ left: 32, top: 24, width: 576, height: 432 }).png().toBuffer(),
    await sharp(source).modulate({ brightness: 1.25 }).png().toBuffer(),
    await sharp(source).flop().png().toBuffer(),
    await sharp(source).resize(640, 400, { fit: 'fill' }).png().toBuffer(),
  ];
  for (const variant of variants) assert.equal(samePhoto(original, await propertyPhotoFingerprint((await f.file(variant)).file)), false);
});

test('photo comparison recognizes a slightly reframed JPEG copy beyond the strict pixel tolerance', async t => {
  const f = await fixture(t), source = await detailedPhoto();
  const copy = await sharp(source).extract({ left: 0, top: 3, width: 640, height: 474 })
    .resize(320, 240).jpeg({ quality: 72 }).toBuffer();
  const original = await propertyPhotoFingerprint((await f.file(source)).file);
  const reframed = await propertyPhotoFingerprint((await f.file(copy)).file);
  assert.ok(original); assert.ok(reframed);
  const meanSquaredError = original.pixels.reduce((sum, value, i) => sum + (value - reframed.pixels[i]!) ** 2, 0) / original.pixels.length;
  assert.ok(meanSquaredError > 36, 'Fixture must exercise the structural and color fallback.');
  assert.equal(samePhoto(original, reframed), true);
  assert.equal(samePhoto(reframed, original), true);
});

test('blank, tiny and mostly white drawings are excluded from approximate photo matching', async t => {
  const f = await fixture(t);
  const white = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const drawing = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="white"/><path d="M80 60 H560 V420 H80 Z M320 60 V420 M80 240 H560" stroke="#222" stroke-width="8" fill="none"/><rect x="96" y="76" width="40" height="90" fill="#999"/><text x="160" y="170" font-size="20">15.4</text></svg>');
  for (const bytes of [white, await sharp(drawing).png().toBuffer(), await detailedPhoto(64, 48)])
    assert.equal(await propertyPhotoFingerprint((await f.file(bytes)).file), null);
  assert.equal(samePhoto(null, null), false);
});

test('photo cache shares concurrent decodes, retains rejected results and refreshes changed files', async t => {
  const f = await fixture(t), source = await detailedPhoto(), item = await f.file(source);
  const prototype = sharp.prototype as any, toBuffer = prototype.toBuffer;
  let decodes = 0;
  prototype.toBuffer = function (...args: any[]) { decodes++; return toBuffer.apply(this, args); };
  t.after(() => { prototype.toBuffer = toBuffer; });
  const [first, concurrent] = await Promise.all([propertyPhotoFingerprint(item.file), propertyPhotoFingerprint(item.file)]);
  assert.deepEqual(first, concurrent); assert.equal(decodes, 1);
  assert.deepEqual(await propertyPhotoFingerprint(item.file), first); assert.equal(decodes, 1);
  const changed = await sharp(source).modulate({ brightness: 1.25 }).png().toBuffer();
  await writeFile(item.path, changed); await utimes(item.path, new Date(), new Date(Date.now() + 2000));
  const before = decodes;
  const next = await propertyPhotoFingerprint(item.file);
  assert.equal(decodes, before + 1); assert.equal(samePhoto(first, next), false);
  const blank = await f.file(await sharp({ create: { width: 100, height: 100, channels: 3, background: '#fff' } }).png().toBuffer());
  assert.equal(await propertyPhotoFingerprint(blank.file), null);
  const afterBlank = decodes;
  assert.equal(await propertyPhotoFingerprint(blank.file), null); assert.equal(decodes, afterBlank);
});

test('photo fingerprint respects a transaction cache without waiting for the global connection pool', async t => {
  const f = await fixture(t), item = await f.file(await detailedPhoto());
  let release = () => {}, entered = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let globalReads = 0, txReads = 0, txWrites = 0;
  db.imageFingerprint.findUnique = (async () => { globalReads++; entered(); await blocked; return null; }) as any;
  const pending = propertyPhotoFingerprint(item.file);
  await started;
  const client = { imageFingerprint: {
    findUnique: async () => { txReads++; return null; },
    upsert: async ({ create }: any) => { txWrites++; return create; },
  } };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      propertyPhotoFingerprint(item.file, client as any),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Transaction waited for global pool')), 2000); }),
    ]);
    assert.ok(result); assert.equal(globalReads, 1); assert.equal(txReads, 1); assert.equal(txWrites, 1);
  } finally { clearTimeout(timer); release(); await pending; }
});

test('photo fingerprint rejects unsafe or broken files and propagates infrastructure failures', async t => {
  const f = await fixture(t);
  await assert.rejects(propertyPhotoFingerprint('/uploads/../private.webp'), { statusCode: 400 });
  await assert.rejects(propertyPhotoFingerprint('/uploads/missing.webp'), { statusCode: 400 });
  await assert.rejects(propertyPhotoFingerprint((await f.file(Buffer.from('broken'))).file), { statusCode: 400 });
  const item = await f.file(await detailedPhoto()), failure = Object.assign(new Error('Database unavailable'), { code: 'P1001' });
  db.imageFingerprint.findUnique = (async () => { throw failure; }) as any;
  await assert.rejects(propertyPhotoFingerprint(item.file), error => error === failure);
});
