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
  const property = { id: 'apartment', type: 'apartment', sourceId: 'rf39:1', complexId: null as string | null, title: 'Ручное название' };
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
  } finally { db.$transaction = transaction; }
});

test('import converts marked plans, keeps draft status and cleans every file on failed image download', async () => {
  const transaction = db.$transaction, originalFetch = globalThis.fetch, originalDir = process.env.UPLOAD_DIR;
  const dir = await mkdtemp(join(tmpdir(), 'newh-import-'));
  process.env.UPLOAD_DIR = dir;
  const source = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#f4d15b' } }).png().toBuffer();
  let created: any;
  const tx = { $executeRaw: async () => {}, property: {
    findUnique: async ({ where }: any) => where.id ? { type: 'complex' } : null,
    findMany: async () => [],
    create: async ({ data }: any) => { created = data; return { id: 'new-apartment' }; },
  }, propertyImportSource: { findMany: async () => [], findUnique: async () => null, upsert: async () => {} } };
  db.$transaction = (async (callback: any) => callback(tx)) as any;
  globalThis.fetch = async () => new Response(source, { headers: { 'Content-Type': 'image/png' } });
  const draft = () => ({ ...rf39Draft({ id: 123, type: 'Квартиры - вторичное жильё', deal_type: 'sale' }),
    imageUrls: ['https://crm.rf39.ru/images/objects/plan.png', 'https://crm.rf39.ru/images/objects/photo.png'], planImageUrls: ['https://crm.rf39.ru/images/objects/plan.png'] });
  try {
    const result = await importProperty(draft(), 'complex-a');
    assert.equal(result.created, true);
    assert.equal(result.linked, true);
    assert.equal(created.published, false);
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
    assert.deepEqual(photoPixels.data, await sharp(source).raw().toBuffer());
    let requests = 0;
    globalThis.fetch = async () => {
      if (++requests === 2) throw new Error('unavailable');
      return new Response(source, { headers: { 'Content-Type': 'image/png' } });
    };
    const failing = draft();
    failing.imageUrls.push('https://crm.rf39.ru/images/objects/missing.png');
    created = null;
    await assert.rejects(importProperty(failing), { statusCode: 502 });
    assert.equal(created, null);
    assert.deepEqual(await readdir(dir), files);
  } finally {
    db.$transaction = transaction; globalThis.fetch = originalFetch;
    if (originalDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = originalDir;
    await rm(dir, { recursive: true, force: true });
  }
});
