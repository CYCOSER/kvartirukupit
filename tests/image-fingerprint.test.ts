import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { db } from '../server/utils/db';
import { imageFingerprint, propertyImageFingerprint } from '../server/utils/image-fingerprint';
import { mockImageFingerprintCache } from './fixtures/image-fingerprint-cache';

const png = (background: string, width = 12, height = 8) =>
  sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();

test('fingerprints ignore metadata and lossless encoding but retain pixels and dimensions', async () => {
  const source = await png('#336699');
  const metadataCopy = await sharp(source).withExif({ IFD0: { ImageDescription: 'A different filename and description' } }).png().toBuffer();
  const webp = await sharp(source).webp({ lossless: true, exact: true }).toBuffer();
  const rgba = await sharp(source).ensureAlpha().png().toBuffer();
  assert.notDeepEqual(source, metadataCopy);
  const hash = await imageFingerprint(source);
  assert.equal(await imageFingerprint(metadataCopy), hash);
  assert.equal(await imageFingerprint(webp), hash);
  assert.equal(await imageFingerprint(rgba), hash);
  assert.notEqual(await imageFingerprint(await png('#336698')), hash);
  assert.notEqual(await imageFingerprint(await png('#336699', 8, 12)), hash);
});

test('fingerprints normalize EXIF orientation before comparing visible pixels', async () => {
  const pixels = Buffer.from([
    255, 0, 0, 0, 255, 0,
    0, 0, 255, 255, 255, 0,
    255, 0, 255, 0, 255, 255,
  ]);
  const source = await sharp(pixels, { raw: { width: 2, height: 3, channels: 3 } }).png().toBuffer();
  const oriented = await sharp(source).withMetadata({ orientation: 6 }).png().toBuffer();
  assert.equal((await sharp(oriented).metadata()).orientation, 6);
  const rotated = await sharp(source).rotate(90).png().toBuffer();
  assert.equal(await imageFingerprint(oriented), await imageFingerprint(rotated));
  assert.notEqual(await imageFingerprint(oriented), await imageFingerprint(source));
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'newh-fingerprint-'));
  const previousDir = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  const cache = mockImageFingerprintCache();
  const name = `${randomUUID()}.webp`, file = `/uploads/${name}`, path = join(dir, name);
  return { dir, file, path, cache, async close() {
    cache.restore();
    if (previousDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  } };
}

test('a persistent fingerprint avoids repeated decoding and refreshes when its file changes', async () => {
  const f = await fixture();
  const prototype = sharp.prototype as any, originalToBuffer = prototype.toBuffer;
  try {
    const first = await png('#336699'), second = await png('#996633');
    await writeFile(f.path, first);
    let decodes = 0;
    prototype.toBuffer = function (...args: any[]) { decodes++; return originalToBuffer.apply(this, args); };
    const [hash, concurrent] = await Promise.all([propertyImageFingerprint(f.file), propertyImageFingerprint(f.file)]);
    assert.equal(concurrent, hash);
    assert.equal(decodes, 1);
    assert.equal(await propertyImageFingerprint(f.file), hash);
    assert.equal(decodes, 1);
    assert.equal(f.cache.rows.size, 1);
    await writeFile(f.path, second);
    await utimes(f.path, new Date(), new Date(Date.now() + 2000));
    assert.notEqual(await propertyImageFingerprint(f.file), hash);
    assert.equal(decodes, 2);
    const cached = f.cache.rows.get(f.file)!;
    assert.equal(await propertyImageFingerprint(f.file), cached.hash);
    assert.equal(decodes, 2);
  } finally { prototype.toBuffer = originalToBuffer; await f.close(); }
});

test('a caller can cache a freshly computed fingerprint without decoding the saved file again', async () => {
  const f = await fixture();
  const prototype = sharp.prototype as any, originalToBuffer = prototype.toBuffer;
  try {
    const source = await png('#336699'), hash = await imageFingerprint(source);
    await writeFile(f.path, source);
    prototype.toBuffer = function () { throw new Error('Cached upload must not decode again'); };
    assert.equal(await propertyImageFingerprint(f.file, hash), hash);
    assert.equal(await propertyImageFingerprint(f.file), hash);
    assert.equal(f.cache.rows.get(f.file)?.hash, hash);
  } finally { prototype.toBuffer = originalToBuffer; await f.close(); }
});

test('a transaction uses its own fingerprint cache without waiting for the global connection pool', async () => {
  const f = await fixture();
  let release = () => {}, entered = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let pending: Promise<string> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let globalReads = 0, globalWrites = 0, transactionReads = 0, transactionWrites = 0;
  try {
    const source = await png('#336699'), hash = await imageFingerprint(source);
    await writeFile(f.path, source);
    db.imageFingerprint.findUnique = (async () => { globalReads++; entered(); await blocked; return null; }) as any;
    db.imageFingerprint.upsert = (async ({ create }: any) => { globalWrites++; return create; }) as any;
    pending = propertyImageFingerprint(f.file);
    await started;
    const client = { imageFingerprint: {
      findUnique: async ({ where }: any) => { transactionReads++; assert.equal(where.file, f.file); return null; },
      upsert: async ({ create }: any) => { transactionWrites++; assert.equal(create.hash, hash); return create; },
    } };
    assert.equal(await Promise.race([
      propertyImageFingerprint(f.file, undefined, client as any),
      new Promise<string>((_, reject) => { timer = setTimeout(() => reject(new Error('Transaction waited for the global pool')), 1000); }),
    ]), hash);
    assert.deepEqual([globalReads, globalWrites, transactionReads, transactionWrites], [1, 0, 1, 1]);
  } finally {
    clearTimeout(timer); release();
    try { await pending; } finally { await f.close(); }
  }
});

test('invalid or missing image files are recoverable while database failures propagate unchanged', async () => {
  const f = await fixture();
  try {
    await assert.rejects(propertyImageFingerprint('/uploads/../secret.webp'), { statusCode: 400 });
    await assert.rejects(propertyImageFingerprint('https://example.com/image.webp'), { statusCode: 400 });
    await assert.rejects(propertyImageFingerprint(f.file), { statusCode: 400 });
    await writeFile(f.path, Buffer.from('broken image'));
    await assert.rejects(propertyImageFingerprint(f.file), { statusCode: 400 });
    await assert.rejects(imageFingerprint(Buffer.from('broken image')), { statusCode: 400 });
    await writeFile(f.path, await png('#336699'));
    const failure = Object.assign(new Error('Database unavailable'), { code: 'P1001' });
    const findUnique = db.imageFingerprint.findUnique;
    db.imageFingerprint.findUnique = (async () => { throw failure; }) as any;
    await assert.rejects(propertyImageFingerprint(f.file), error => error === failure);
    db.imageFingerprint.findUnique = findUnique;
    db.imageFingerprint.upsert = (async () => { throw failure; }) as any;
    await assert.rejects(propertyImageFingerprint(f.file), error => error === failure);
  } finally { await f.close(); }
});
