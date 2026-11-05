import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { db } from '../server/utils/db';
import { prepareImportImages } from '../server/utils/import-images';

const imageUrl = (name: string) => `https://crm.rf39.ru/images/objects/${name}.png`;
const draft = (imageUrls: string[], planImageUrls: string[] = []) => ({ imageUrls, planImageUrls, data: { title: 'Квартира у парка' } });
const png = (background: string) => sharp({ create: { width: 48, height: 32, channels: 3, background } }).png().toBuffer();

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'newh-import-images-'));
  const previousDir = process.env.UPLOAD_DIR, previousFetch = globalThis.fetch;
  const cache = db.importImageCache;
  const originals = { findUnique: cache.findUnique, upsert: cache.upsert, updateMany: cache.updateMany };
  const rows = new Map<string, any>();
  cache.findUnique = (async ({ where }: any) => structuredClone(rows.get(where.url) || null)) as any;
  cache.upsert = (async ({ where, create, update }: any) => {
    const row = { ...(rows.get(where.url) || create), ...update };
    rows.set(where.url, structuredClone(row));
    return structuredClone(row);
  }) as any;
  cache.updateMany = (async ({ where, data }: any) => {
    const row = rows.get(where.url);
    if (!row || row.contentHash !== where.contentHash) return { count: 0 };
    Object.assign(row, structuredClone(data));
    return { count: 1 };
  }) as any;
  process.env.UPLOAD_DIR = dir;
  return { dir, rows, async close() {
    Object.assign(cache, originals); globalThis.fetch = previousFetch;
    if (previousDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  } };
}

test('image downloads share a bounded pool, preserve ordering and deduplicate URLs and identical content across cards', async () => {
  const f = await fixture();
  try {
    const buffers = await Promise.all(['#113355', '#bb9977', '#eecc44'].map(png));
    const urls = Array.from({ length: 12 }, (_, i) => imageUrl(`pool-${i}`));
    const requests = new Map<string, number>();
    let active = 0, maximum = 0;
    globalThis.fetch = async (input, options) => {
      const url = String(input), index = Number(url.match(/pool-(\d+)/)![1]);
      requests.set(url, (requests.get(url) || 0) + 1);
      assert.equal(options?.redirect, 'error');
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, (12 - index) * 2));
      active--;
      return new Response(buffers[index % 3], { headers: { 'Content-Type': 'image/png' } });
    };
    const [first, second] = await Promise.all([
      prepareImportImages(draft([...urls, urls[0]!])),
      prepareImportImages(draft([urls[1]!, urls[0]!])),
    ]);
    assert.ok(maximum > 1 && maximum <= 6);
    assert.equal(requests.size, 12);
    assert.ok([...requests.values()].every(count => count === 1));
    assert.equal(first.images.length, 3);
    assert.deepEqual(first.images.map(image => image.order), [0, 1, 2]);
    assert.equal(second.images[0]!.file, first.images[1]!.file);
    assert.equal(second.images[1]!.file, first.images[0]!.file);
    assert.deepEqual(first.warnings, []);
    assert.equal((await readdir(f.dir)).length, 3);
    const repeated = await prepareImportImages(draft(urls));
    assert.deepEqual(repeated, first);
    assert.equal([...requests.values()].reduce((sum, count) => sum + count, 0), 12);
  } finally { await f.close(); }
});

test('persistent cache revalidates after one day and redownloads a missing file without stale validators', async () => {
  const f = await fixture();
  try {
    const url = imageUrl('conditional'), source = await png('#225588');
    let requests = 0;
    globalThis.fetch = async () => {
      requests++;
      return new Response(source, { headers: { 'Content-Type': 'image/png', ETag: 'image-1', 'Last-Modified': 'Mon, 02 Nov 2026 12:00:00 GMT' } });
    };
    const first = await prepareImportImages(draft([url]));
    f.rows.get(url).checkedAt = new Date(Date.now() - 2 * 86400000);
    globalThis.fetch = async (_url, options) => {
      requests++;
      assert.deepEqual(options?.headers, { 'If-None-Match': 'image-1', 'If-Modified-Since': 'Mon, 02 Nov 2026 12:00:00 GMT' });
      return new Response(null, { status: 304 });
    };
    assert.deepEqual(await prepareImportImages(draft([url])), first);
    assert.deepEqual(await prepareImportImages(draft([url])), first);
    assert.equal(requests, 2);
    await unlink(join(f.dir, first.images[0]!.originalFile.split('/').pop()!));
    const replacement = await png('#88bb44');
    globalThis.fetch = async (_url, options) => {
      requests++;
      assert.deepEqual(options?.headers, {});
      return new Response(replacement, { headers: { 'Content-Type': 'image/png', ETag: 'image-2' } });
    };
    const next = await prepareImportImages(draft([url]));
    assert.notEqual(next.images[0]!.file, first.images[0]!.file);
    assert.equal(requests, 3);
    assert.equal(f.rows.get(url).etag, 'image-2');
    assert.equal((await readdir(f.dir)).length, 1);
  } finally { await f.close(); }
});

test('duplicate plan wins over the same photo, retains first position and reuses plan metadata', async () => {
  const f = await fixture();
  try {
    const photoUrl = imageUrl('same-photo'), planUrl = imageUrl('same-plan'), source = await png('#f4d15b');
    let requests = 0;
    globalThis.fetch = async () => { requests++; return new Response(source, { headers: { 'Content-Type': 'image/png' } }); };
    const first = await prepareImportImages(draft([photoUrl, planUrl], [planUrl]));
    assert.equal(first.images.length, 1);
    assert.equal(first.images[0]!.kind, 'plan');
    assert.equal(first.images[0]!.order, 0);
    assert.notEqual(first.images[0]!.file, first.images[0]!.originalFile);
    assert.ok(Number.isInteger(first.images[0]!.hueShift));
    assert.equal(f.rows.get(planUrl).planFile, first.images[0]!.file);
    assert.deepEqual(await prepareImportImages(draft([planUrl], [planUrl])), first);
    assert.equal(requests, 2);
    assert.equal((await readdir(f.dir)).length, 2);
  } finally { await f.close(); }
});

test('invalid hosts, oversized and corrupt images are skipped while good photos remain; infrastructure errors propagate', async () => {
  const f = await fixture();
  try {
    const source = await png('#336699'), requests: string[] = [];
    globalThis.fetch = async input => {
      const url = String(input); requests.push(url);
      if (url.includes('oversized')) return new Response(source, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(11 * 1024 * 1024) } });
      if (url.includes('corrupt')) return new Response('bad image', { headers: { 'Content-Type': 'image/png' } });
      return new Response(source, { headers: { 'Content-Type': 'image/png' } });
    };
    const result = await prepareImportImages(draft(['https://localhost/private.png', imageUrl('oversized'), imageUrl('corrupt'), imageUrl('valid')]));
    assert.equal(requests.length, 3);
    assert.equal(result.images.length, 1);
    assert.deepEqual(result.warnings.map(warning => warning.match(/№\d+/)![0]), ['№1', '№2', '№3']);
    assert.equal((await readdir(f.dir)).length, 1);
    const none = await prepareImportImages(draft([imageUrl('corrupt')]));
    assert.equal(none.images.length, 0);
    assert.ok(none.warnings.at(-1)!.startsWith('В источнике нет доступных фотографий.'));
    const failure = Object.assign(new Error('Database unavailable'), { code: 'P1001' });
    db.importImageCache.findUnique = (async () => { throw failure; }) as any;
    await assert.rejects(prepareImportImages(draft([imageUrl('database-error')])), error => error === failure);
  } finally { await f.close(); }
});
