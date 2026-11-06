import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { db } from '../server/utils/db';
import { deduplicatePropertyImages } from '../server/utils/image-dedup';
import { mockImageFingerprintCache } from './fixtures/image-fingerprint-cache';
import { detailedPhoto } from './fixtures/photo';

const png = (color: string) => sharp({ create: { width: 48, height: 32, channels: 3, background: color } }).png().toBuffer();

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'newh-cleanup-images-'));
  const previousDir = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  const cache = mockImageFingerprintCache();
  const gallery: any[] = [];
  const originals = { findMany: db.propertyImage.findMany, deleteMany: db.propertyImage.deleteMany,
    update: db.propertyImage.update, transaction: db.$transaction };
  t.after(async () => {
    Object.assign(db.propertyImage, { findMany: originals.findMany, deleteMany: originals.deleteMany, update: originals.update });
    db.$transaction = originals.transaction;
    cache.restore();
    if (previousDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  });
  db.propertyImage.findMany = (async ({ where }: any) => structuredClone(gallery.filter(image => image.propertyId === where.propertyId))) as any;
  const deletes = t.mock.fn(async ({ where }: any) => {
    const ids = new Set(where.id.in);
    let count = 0;
    for (let i = gallery.length - 1; i >= 0; i--) {
      if (gallery[i].propertyId === where.propertyId && ids.has(gallery[i].id)) { gallery.splice(i, 1); count++; }
    }
    return { count };
  });
  db.propertyImage.deleteMany = deletes as any;
  db.propertyImage.update = (async ({ where, data }: any) => Object.assign(gallery.find(image => image.id === where.id), data)) as any;
  const locks: string[] = [];
  const transaction = t.mock.fn(async (callback: any) => callback({
    propertyImage: db.propertyImage,
    imageFingerprint: db.imageFingerprint,
    $executeRaw: async (sql: TemplateStringsArray) => { locks.push(sql.join('?')); return 1; },
    $queryRaw: async (sql: TemplateStringsArray, propertyId: string) => {
      locks.push(sql.join('?'));
      return structuredClone(gallery.filter(image => image.propertyId === propertyId).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)));
    },
  }));
  db.$transaction = transaction as any;
  async function file(bytes: Buffer) {
    const name = randomUUID() + '.webp';
    await writeFile(join(dir, name), bytes);
    return '/uploads/' + name;
  }
  function add(id: string, file: string, order: number, kind = 'photo', propertyId = 'property') {
    gallery.push({ id, propertyId, file, originalFile: file, kind, order });
  }
  return { dir, gallery, cache, file, add, deletes, locks, transaction };
}

test('cleanup previews without deleting, then removes pixel duplicates per card and preserves first position with plan priority', async t => {
  const f = await fixture(t), red = await png('#cc4411');
  const original = await f.file(red), metadata = await f.file(await sharp(red).withMetadata().png().toBuffer());
  const webp = await f.file(await sharp(red).webp({ lossless: true }).toBuffer()), blue = await f.file(await png('#1144cc'));
  f.add('photo', original, 0); f.add('blue', blue, 1); f.add('plan', metadata, 2, 'plan'); f.add('duplicate', webp, 3);
  f.add('other-card', original, 0, 'photo', 'other');
  const files = await readdir(f.dir);
  assert.deepEqual(await deduplicatePropertyImages('property'), { scanned: 4, duplicates: 2, deleted: 0, warnings: [] });
  assert.equal(f.gallery.length, 5);
  assert.equal(f.deletes.mock.callCount(), 0);
  assert.deepEqual(await deduplicatePropertyImages('property', true), { scanned: 4, duplicates: 2, deleted: 2, warnings: [] });
  assert.deepEqual(f.gallery.map(image => [image.id, image.order]), [['blue', 1], ['plan', 0], ['other-card', 0]]);
  assert.deepEqual(await readdir(f.dir), files, 'shared image files are retained');
  assert.ok(f.locks.some(sql => sql.includes('pg_advisory_xact_lock')));
  assert.ok(f.locks.some(sql => sql.includes('FOR UPDATE')));
  assert.deepEqual(await deduplicatePropertyImages('property', true), { scanned: 2, duplicates: 0, deleted: 0, warnings: [] });
});

test('cleanup compares the current crop, keeps distinct dimensions and rechecks changes made before the row lock', async t => {
  const f = await fixture(t), source = await png('#cc4411');
  const full = await f.file(source), cropped = await f.file(await sharp(source).extract({ left: 0, top: 0, width: 24, height: 16 }).png().toBuffer());
  f.add('full', full, 0); f.add('edited', cropped, 1);
  f.gallery[1].originalFile = full;
  f.add('concurrent-edit', full, 2);
  const transaction = db.$transaction as any;
  db.$transaction = (async (...args: any[]) => {
    f.gallery.find(image => image.id === 'concurrent-edit').file = await f.file(await png('#1144cc'));
    return transaction(...args);
  }) as any;
  const result = await deduplicatePropertyImages('property', true);
  assert.equal(result.deleted, 0);
  assert.equal(f.gallery.length, 3);
});

test('missing and corrupt files are reported and retained while valid duplicates are removed', async t => {
  const f = await fixture(t), good = await f.file(await png('#cc4411'));
  f.add('missing', '/uploads/' + randomUUID() + '.webp', 0);
  f.add('corrupt', await f.file(Buffer.from('invalid image')), 1);
  f.add('good', good, 2); f.add('duplicate', good, 3);
  const result = await deduplicatePropertyImages('property', true);
  assert.equal(result.deleted, 1);
  assert.equal(result.warnings.length, 2);
  assert.deepEqual(f.gallery.map(image => image.id), ['missing', 'corrupt', 'good']);
});

test('database failures are not treated as broken photos', async t => {
  const f = await fixture(t);
  f.add('photo', await f.file(await png('#cc4411')), 0);
  const failure = Object.assign(new Error('Database unavailable'), { code: 'P1001' });
  db.imageFingerprint.findUnique = (async () => { throw failure; }) as any;
  await assert.rejects(deduplicatePropertyImages('property', true), error => error === failure);
  assert.equal(f.gallery.length, 1);
  assert.equal(f.transaction.mock.callCount(), 0);
});

test('cleanup removes resized and slightly cropped source copies but preserves plans, manual edits and other cards', async t => {
  const f = await fixture(t), source = await detailedPhoto();
  const original = await f.file(source);
  const copy = await f.file(await sharp(source).resize(480, 360).jpeg({ quality: 82 }).toBuffer());
  const cropped = await f.file(await sharp(source).extract({ left: 0, top: 3, width: 640, height: 474 }).resize(320, 240).jpeg({ quality: 72 }).toBuffer());
  const changed = await f.file(await sharp(source).modulate({ hue: 80 }).png().toBuffer());
  const recoloured = await f.file(await sharp(source).modulate({ hue: 4 }).jpeg({ quality: 73 }).toBuffer());
  f.add('original', original, 0);
  f.add('copy', copy, 1);
  f.add('source-crop', cropped, 2);
  f.add('changed', changed, 3);
  f.add('edited', cropped, 4);
  f.gallery.at(-1).crop = { left: 0, top: 3, width: 640, height: 474 };
  f.add('colour-edit', recoloured, 5);
  f.gallery.at(-1).hueShift = 4;
  const planCopy = await f.file(await sharp(source).resize(400, 300).jpeg({ quality: 90 }).toBuffer());
  f.add('plan-copy', planCopy, 6, 'plan');
  f.add('other', copy, 0, 'photo', 'other');
  const preview = await deduplicatePropertyImages('property');
  assert.equal(preview.duplicates, 2);
  assert.equal(preview.deleted, 0);
  const result = await deduplicatePropertyImages('property', true);
  assert.equal(result.deleted, 2);
  assert.deepEqual(f.gallery.map(image => image.id), ['original', 'changed', 'edited', 'colour-edit', 'plan-copy', 'other']);
  assert.equal((await deduplicatePropertyImages('property', true)).deleted, 0);
});

test('cleanup retries known transaction conflicts at most three times', async t => {
  const f = await fixture(t), file = await f.file(await png('#cc4411'));
  f.add('first', file, 0); f.add('duplicate', file, 1);
  const transaction = db.$transaction as any;
  let attempts = 0;
  db.$transaction = (async (...args: any[]) => {
    if (++attempts < 3) throw Object.assign(new Error('Serialization failure'), { code: 'P2034' });
    return transaction(...args);
  }) as any;
  assert.equal((await deduplicatePropertyImages('property', true)).deleted, 1);
  assert.equal(attempts, 3);
  attempts = 0;
  db.$transaction = (async () => { attempts++; throw Object.assign(new Error('Deadlock'), { code: 'P2010', meta: { code: '40P01' } }); }) as any;
  await assert.rejects(deduplicatePropertyImages('property', true));
  assert.equal(attempts, 3);
});
