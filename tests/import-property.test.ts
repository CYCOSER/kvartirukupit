import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { db } from '../server/utils/db';
import { existingImportedProperty, importProperty } from '../server/utils/import-property';
import { rf39Draft } from '../server/utils/rf39-data';

test('repeat import links once, preserves content and refuses another complex', async () => {
  const transaction = db.$transaction;
  const property = { id: 'apartment', type: 'apartment', sourceId: 'rf39:1', slug: 'rf39-1', complexId: null as string | null, title: 'Ручное название' };
  let writes = 0;
  const tx = {
    $executeRaw: async () => {},
    property: {
      findUnique: async ({ where }: any) => where.id ? { type: 'complex' } : property,
      findMany: async ({ where }: any) => where.sourceId.in.includes(property.sourceId) ? [property] : [],
      update: async ({ data }: any) => { writes++; Object.assign(property, data); },
    },
    propertyImportSource: { findMany: async () => [], findUnique: async () => null, upsert: async () => {} },
  };
  db.$transaction = (async (callback: any) => callback(tx)) as any;
  try {
    assert.equal((await existingImportedProperty('rf39:1', 'complex-a'))?.linked, true);
    assert.equal((await existingImportedProperty('rf39:1', 'complex-a'))?.linked, false);
    await assert.rejects(existingImportedProperty('rf39:1', 'complex-b'), { statusCode: 409 });
    assert.equal(writes, 1);
    assert.equal(property.title, 'Ручное название');
    assert.equal(property.complexId, 'complex-a');
    const repeated = await importProperty(rf39Draft({ id: 1, type: 'Квартиры - вторичное жильё', deal_type: 'sale' }));
    assert.equal(repeated.created, false);
    assert.equal(property.slug, 'rf39-1');
  } finally { db.$transaction = transaction; }
});

test('import converts marked plans, keeps CRM publication flags and skips failed images without deleting shared files', async () => {
  const transaction = db.$transaction, originalFetch = globalThis.fetch, originalDir = process.env.UPLOAD_DIR;
  const cache = db.importImageCache;
  const findUnique = cache.findUnique, upsert = cache.upsert, updateMany = cache.updateMany;
  const records = new Map<string, any>();
  cache.findUnique = (async ({ where }: any) => records.get(where.url) || null) as any;
  cache.upsert = (async ({ where, create, update }: any) => { const row = { ...(records.get(where.url) || create), ...update }; records.set(where.url, row); return { ...row }; }) as any;
  cache.updateMany = (async ({ where, data }: any) => { const row = records.get(where.url); if (!row || row.contentHash !== where.contentHash) return { count: 0 }; Object.assign(row, data); return { count: 1 }; }) as any;
  const dir = await mkdtemp(join(tmpdir(), 'newh-import-'));
  process.env.UPLOAD_DIR = dir;
  const source = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#f4d15b' } }).png().toBuffer();
  const photoSource = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#339977' } }).png().toBuffer();
  let created: any;
  const tx = { $executeRaw: async () => {}, property: {
    findUnique: async ({ where }: any) => where.id ? { type: 'complex' } : null,
    findMany: async () => [],
    create: async ({ data }: any) => { created = data; return { id: 'new-apartment' }; },
  }, propertyImportSource: { findMany: async () => [], findUnique: async () => null, upsert: async () => {} } };
  db.$transaction = (async (callback: any) => callback(tx)) as any;
  globalThis.fetch = async url => new Response(String(url).endsWith('plan.png') ? source : photoSource, { headers: { 'Content-Type': 'image/png' } });
  const draft = () => ({ ...rf39Draft({ id: 123, type: 'Квартиры - вторичное жильё', deal_type: 'sale' }),
    imageUrls: ['https://crm.rf39.ru/images/objects/plan.png', 'https://crm.rf39.ru/images/objects/photo.png'], planImageUrls: ['https://crm.rf39.ru/images/objects/plan.png'] });
  try {
    const result = await importProperty(draft(), 'complex-a');
    assert.equal(result.created, true);
    assert.equal(result.linked, true);
    assert.equal(created.published, true);
    assert.equal(created.slug, 'robj-123');
    assert.equal(created.elite, true);
    assert.deepEqual(created.rf39Baseline.manualFields, []);
    assert.equal(created.rf39Baseline.values.title, created.title);
    assert.doesNotMatch(created.sourceNote, /перед публикацией/);
    assert.equal(created.complexId, 'complex-a');
    assert.equal(created.images.create[0].kind, 'plan');
    const files = await readdir(dir);
    const imported = created.images.create[0];
    const pixels = await sharp(await readFile(join(dir, imported.file.split('/').pop()))).raw().toBuffer();
    assert.ok(pixels[2]! > pixels[1]! && pixels[1]! > pixels[0]!);
    const original = await readFile(join(dir, imported.originalFile.split('/').pop()));
    assert.deepEqual(await sharp(original).raw().toBuffer(), await sharp(source).raw().toBuffer());
    assert.notEqual(imported.file, imported.originalFile);
    assert.ok(Number.isInteger(imported.hueShift));
    const photo = created.images.create[1];
    assert.equal(photo.kind, 'photo');
    const photoBytes = await readFile(join(dir, photo.file.split('/').pop()));
    const photoPixels = await sharp(photoBytes).raw().toBuffer({ resolveWithObject: true });
    assert.equal(photoPixels.info.width, 2400);
    assert.equal(photoPixels.info.height, 1600);
    assert.deepEqual(photoPixels.data, await sharp(photoSource).raw().toBuffer());
    let requests = 0;
    globalThis.fetch = async () => {
      requests++;
      throw new Error('unavailable');
    };
    const failing = draft();
    failing.imageUrls.push('https://crm.rf39.ru/images/objects/missing.png');
    created = null;
    const partial = await importProperty(failing);
    assert.equal(requests, 1);
    assert.equal(partial.created, true);
    assert.equal(created.images.create.length, 2);
    assert.ok(partial.warnings.some(warning => warning.includes('фотографию №3')));
    assert.deepEqual(await readdir(dir), files);
    tx.property.create = async () => { throw new Error('database write rejected'); };
    await assert.rejects(importProperty(draft()), { statusCode: 502 });
    assert.deepEqual(await readdir(dir), files);
  } finally {
    db.$transaction = transaction; globalThis.fetch = originalFetch;
    cache.findUnique = findUnique; cache.upsert = upsert; cache.updateMany = updateMany;
    if (originalDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = originalDir;
    await rm(dir, { recursive: true, force: true });
  }
});
