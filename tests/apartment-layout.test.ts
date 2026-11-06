import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { db } from '../server/utils/db';
import { findApartmentLayout, layoutScopeWhere, mergeLayoutAvailability, prepareApartmentLayout } from '../server/utils/apartment-layout';
import { mockImageFingerprintCache } from './fixtures/image-fingerprint-cache';

const apartment = { type: 'apartment', housingMarket: 'newbuild', nmarketComplexId: '71' };
const png = (background: string) => sharp({ create: { width: 24, height: 16, channels: 3, background } }).png().toBuffer();

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'apartment-layout-'));
  const previousDir = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  const cache = mockImageFingerprintCache();
  t.after(async () => {
    cache.restore();
    if (previousDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  });
  return async (bytes: Buffer, kind = 'plan') => {
    const name = randomUUID() + '.webp';
    await writeFile(join(dir, name), bytes);
    return { kind, file: '/uploads/' + name };
  };
}

test('layout identity compares the full unordered plan set and uses originals before recolouring', async t => {
  const file = await fixture(t), red = await png('#bb4411');
  const first = await file(red), metadata = await file(await sharp(red).withMetadata().png().toBuffer());
  const common = await file(await png('#555555')), other = await file(await png('#1144bb'));
  const hash = await prepareApartmentLayout(apartment, [common, first]);
  assert.match(hash!, /^[a-f0-9]{64}$/);
  assert.equal(await prepareApartmentLayout(apartment, [metadata, common, first]), hash);
  assert.equal(await prepareApartmentLayout(apartment, [common, { ...other, originalFile: first.file }]), hash);
  assert.notEqual(await prepareApartmentLayout(apartment, [common, other]), hash);
  assert.notEqual(await prepareApartmentLayout(apartment, [common]), hash);
  assert.equal(await prepareApartmentLayout(apartment, [common, first, { ...other, kind: 'photo' }]), hash);
});

test('missing plans and unsupported objects never create a partial layout identity; DB failures propagate', async t => {
  const file = await fixture(t), image = await file(await png('#bb4411'));
  assert.equal(await prepareApartmentLayout(apartment, []), null);
  assert.equal(await prepareApartmentLayout(apartment, [{ ...image, kind: 'photo' }]), null);
  assert.equal(await prepareApartmentLayout({ ...apartment, housingMarket: 'secondary' }, [image]), null);
  assert.equal(await prepareApartmentLayout({ ...apartment, type: 'complex' }, [image]), null);
  t.mock.method(console, 'warn', () => {});
  assert.equal(await prepareApartmentLayout(apartment, [image, { kind: 'plan', file: '/uploads/' + randomUUID() + '.webp' }]), null);
  const failure = Object.assign(new Error('Database unavailable'), { code: 'P1001' });
  db.imageFingerprint.findUnique = (async () => { throw failure; }) as any;
  await assert.rejects(prepareApartmentLayout(apartment, [image]), error => error === failure);
});

test('layout availability uses the cheapest known price and distinct apartment floors, never building height', () => {
  assert.deepEqual(mergeLayoutAvailability([
    { price: 5_200_000, availableFloors: [5, 2, 5], floors: 20 },
    { price: 4_882_500, availableFloors: [2, 8] },
    { price: null, availableFloors: [0, -1, 101, 2.5] },
  ] as any), { price: 4_882_500, availableFloors: [2, 5, 8] });
  assert.deepEqual(mergeLayoutAvailability([{ price: null }, { price: 0 }]), { price: null, availableFloors: [] });
});

test('layout matching requires a known complex and refuses candidates assigned to conflicting local complexes', async () => {
  assert.equal(layoutScopeWhere({ type: 'apartment', housingMarket: 'newbuild' }), null);
  assert.equal(layoutScopeWhere({ ...apartment, housingMarket: 'secondary' }), null);
  let queries = 0;
  const candidates = [{ id: 'first', complexId: 'local-a' }, { id: 'second', complexId: 'local-b' }];
  const tx = { property: { findMany: async () => { queries++; return candidates; } } } as any;
  assert.equal(await findApartmentLayout(tx, { type: 'apartment', housingMarket: 'newbuild' }, 'hash'), null);
  assert.equal(queries, 0);
  assert.equal(await findApartmentLayout(tx, apartment, 'hash'), null);
  candidates[1]!.complexId = 'local-a';
  assert.equal((await findApartmentLayout(tx, apartment, 'hash'))?.id, 'first');
});
