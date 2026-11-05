import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp, createRouter, toWebHandler } from 'h3';
import sharp from 'sharp';
import { db } from '../server/utils/db';
import upload from '../server/api/admin/properties/[id]/images.post';

const png = (color = '#aa7744') => sharp({ create: { width: 32, height: 24, channels: 3, background: color } }).png().toBuffer();

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'newh-upload-dedup-'));
  const previousDir = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  t.after(async () => {
    if (previousDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  });
  const gallery: any[] = [], hashes = new Map<string, any>();
  const originals = { property: db.property.findUnique, findMany: db.propertyImage.findMany, create: db.propertyImage.create,
    findHash: db.imageFingerprint.findUnique, saveHash: db.imageFingerprint.upsert, transaction: db.$transaction };
  t.after(() => {
    db.property.findUnique = originals.property;
    Object.assign(db.propertyImage, { findMany: originals.findMany, create: originals.create });
    Object.assign(db.imageFingerprint, { findUnique: originals.findHash, upsert: originals.saveHash });
    db.$transaction = originals.transaction;
  });
  db.property.findUnique = (async ({ where }: any) => ['property', 'other-property'].includes(where.id) ? { id: where.id } : null) as any;
  db.propertyImage.findMany = (async ({ where }: any) => structuredClone(gallery.filter(image => image.propertyId === where.propertyId))) as any;
  const create = t.mock.fn(async ({ data }: any) => {
    const image = { id: randomUUID(), ...data, kind: 'photo', hueShift: 0, crop: null };
    gallery.push(image);
    return structuredClone(image);
  });
  db.propertyImage.create = create as any;
  const findHash = async ({ where }: any) => structuredClone(hashes.get(where.file) || null);
  db.imageFingerprint.findUnique = findHash as any;
  const persistHash = t.mock.fn(async ({ where, create, update }: any) => {
    const row = { ...(hashes.get(where.file) || create), ...update };
    hashes.set(where.file, structuredClone(row));
    return structuredClone(row);
  });
  db.imageFingerprint.upsert = persistHash as any;
  const lockRows = t.mock.fn(async (sql: TemplateStringsArray) => {
    assert.match(sql.join(''), /SELECT "id" FROM "PropertyImage" WHERE "propertyId" = .* ORDER BY "id" FOR UPDATE/);
    return [];
  });
  let previous = Promise.resolve();
  const transaction = t.mock.fn(async (callback: any) => {
    const pending = previous;
    let release!: () => void;
    previous = new Promise<void>(resolve => { release = resolve; });
    await pending;
    try { return await callback({ propertyImage: db.propertyImage, imageFingerprint: { findUnique: findHash, upsert: persistHash },
      $executeRaw: async () => 1, $queryRaw: lockRows }); }
    finally { release(); }
  });
  db.$transaction = transaction as any;
  const app = createApp();
  app.use(createRouter().post('/properties/:id/images', upload));
  const handle = toWebHandler(app);
  const request = (source: Buffer, propertyId = 'property', name = 'image.png', type = 'image/png') => {
    const body = new FormData();
    body.set('file', new Blob([new Uint8Array(source)], { type }), name);
    body.set('alt', 'Uploaded photo');
    return handle(new Request(`http://localhost/properties/${propertyId}/images`, { method: 'POST', body }));
  };
  return { dir, gallery, hashes, request, create, transaction, persistHash, lockRows };
}

test('manual upload skips identical pixels despite different metadata, format or filename', async t => {
  const f = await fixture(t), source = await png();
  const first = await f.request(source);
  assert.equal(first.status, 200);
  const image = await first.json();
  const files = await readdir(f.dir);
  const variants = [
    { data: source, name: 'renamed.png', type: 'image/png' },
    { data: await sharp(source).withMetadata().png().toBuffer(), name: 'metadata.png', type: 'image/png' },
    { data: await sharp(source).webp({ lossless: true }).toBuffer(), name: 'same.webp', type: 'image/webp' },
  ];
  for (const variant of variants) {
    const response = await f.request(variant.data, 'property', variant.name, variant.type);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ...image, duplicate: true });
  }
  assert.equal(f.gallery.length, 1);
  assert.deepEqual(await readdir(f.dir), files);
  assert.equal(f.persistHash.mock.callCount(), 1, 'known fingerprints are reused');
});

test('manual upload keeps distinct photos and compares only the current property gallery', async t => {
  const f = await fixture(t), source = await png();
  const first = await (await f.request(source)).json();
  const second = await (await f.request(await png('#4466aa'))).json();
  const other = await (await f.request(source, 'other-property')).json();
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.id, other.id);
  assert.equal(f.gallery.length, 3);
  assert.equal(other.propertyId, 'other-property');
  assert.equal((await f.request(source, 'missing-property')).status, 404);
});

test('manual upload compares visible edited pixels instead of the unchanged original', async t => {
  const f = await fixture(t), source = await png();
  const original = await (await f.request(source)).json();
  const cropped = await sharp(source).extract({ left: 0, top: 0, width: 16, height: 12 }).webp({ lossless: true }).toBuffer();
  const editedFile = '/uploads/' + randomUUID() + '.webp';
  await writeFile(join(f.dir, basename(editedFile)), cropped);
  f.gallery[0].file = editedFile;
  const reuploaded = await (await f.request(source)).json();
  assert.notEqual(reuploaded.id, original.id);
  assert.equal(f.gallery.length, 2);
  const duplicate = await (await f.request(cropped, 'property', 'cropped.webp', 'image/webp')).json();
  assert.equal(duplicate.id, original.id);
  assert.equal(duplicate.duplicate, true);
  assert.equal(f.gallery.length, 2);
});

test('concurrent identical uploads recheck the gallery under its lock and create one image', async t => {
  const f = await fixture(t), source = await png();
  const responses = await Promise.all([f.request(source), f.request(source), f.request(source)]);
  assert.ok(responses.every(response => response.status === 200));
  const images = await Promise.all(responses.map(response => response.json()));
  assert.equal(new Set(images.map(image => image.id)).size, 1);
  assert.equal(images.filter(image => image.duplicate).length, 2);
  assert.equal(f.create.mock.callCount(), 1);
  assert.equal(f.gallery.length, 1);
  assert.equal((await readdir(f.dir)).length, 1);
});

test('missing or corrupt gallery files do not block valid uploads', async t => {
  const f = await fixture(t), warnings = t.mock.method(console, 'warn', () => {});
  const missing = '/uploads/' + randomUUID() + '.webp', corrupt = '/uploads/' + randomUUID() + '.webp';
  await writeFile(join(f.dir, basename(corrupt)), 'broken image');
  f.gallery.push({ id: 'missing', propertyId: 'property', file: missing, order: 0 },
    { id: 'corrupt', propertyId: 'property', file: corrupt, order: 1 });
  assert.equal((await f.request(await png())).status, 200);
  assert.equal(f.gallery.length, 3);
  assert.equal(warnings.mock.callCount(), 2);
});

test('a duplicate is accepted at the gallery limit and a new image is rejected without writing a file', async t => {
  const f = await fixture(t), source = await png();
  const first = await (await f.request(source)).json();
  for (let i = 1; i < 100; i++) f.gallery.push({ ...first, id: `legacy-${i}`, order: i });
  const files = await readdir(f.dir);
  const duplicate = await (await f.request(source)).json();
  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.duplicate, true);
  assert.equal((await f.request(await png('#4466aa'))).status, 400);
  assert.deepEqual(await readdir(f.dir), files);
  assert.equal(f.gallery.length, 100);
});

test('fingerprint database failures stop the affected upload and failed insertion removes its new file', async t => {
  const f = await fixture(t), source = await png();
  f.persistHash.mock.mockImplementation(async () => { throw new Error('Fingerprint database unavailable'); });
  assert.equal((await f.request(source)).status, 500);
  assert.equal(f.gallery.length, 0);
  assert.deepEqual(await readdir(f.dir), []);
  f.persistHash.mock.mockImplementation(async ({ create }: any) => create);
  f.create.mock.mockImplementation(async () => { throw new Error('Image database unavailable'); });
  assert.equal((await f.request(source)).status, 500);
  assert.equal(f.gallery.length, 0);
  assert.deepEqual(await readdir(f.dir), []);
});

test('database failures while comparing an existing gallery are not skipped as unreadable files', async t => {
  const f = await fixture(t), source = await png();
  assert.equal((await f.request(source)).status, 200);
  const files = await readdir(f.dir);
  db.imageFingerprint.findUnique = (async () => { throw new Error('Fingerprint lookup unavailable'); }) as any;
  assert.equal((await f.request(source)).status, 500);
  assert.equal(f.gallery.length, 1);
  assert.deepEqual(await readdir(f.dir), files);
});

test('a new upload saves its fingerprint on the transaction connection when the global pool is busy', async t => {
  const f = await fixture(t);
  db.imageFingerprint.findUnique = (async () => { throw new Error('Global connection pool is occupied'); }) as any;
  db.imageFingerprint.upsert = (async () => { throw new Error('Global connection pool is occupied'); }) as any;
  assert.equal((await f.request(await png())).status, 200);
  assert.equal(f.gallery.length, 1);
  assert.equal(f.hashes.size, 1);
  assert.equal(f.lockRows.mock.callCount(), 1);
});

test('the locked gallery recheck uses the transaction connection for a concurrently added image', async t => {
  const f = await fixture(t), source = await png();
  const file = '/uploads/' + randomUUID() + '.webp';
  await writeFile(join(f.dir, basename(file)), await sharp(source).webp({ lossless: true }).toBuffer());
  db.imageFingerprint.findUnique = (async () => { throw new Error('Global connection pool is occupied'); }) as any;
  db.imageFingerprint.upsert = (async () => { throw new Error('Global connection pool is occupied'); }) as any;
  f.lockRows.mock.mockImplementation(async () => {
    f.gallery.push({ id: 'concurrent-image', propertyId: 'property', file, originalFile: file, order: 0 });
    return [];
  });
  const response = await f.request(source);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).id, 'concurrent-image');
  assert.equal(f.create.mock.callCount(), 0);
  assert.equal(f.gallery.length, 1);
  assert.equal(f.hashes.size, 1);
});
