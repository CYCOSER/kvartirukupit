import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { db } from '../server/utils/db';
import { findApartmentLayout, layoutScopeWhere, mergeLayoutAvailability, prepareApartmentLayout, sameApartmentLayout, sameApartmentLayoutScope } from '../server/utils/apartment-layout';
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

test('explicit floor diagrams do not identify an apartment or prevent matching its complete unit-plan set', async t => {
  const file = await fixture(t), unit = { ...await file(await png('#bb4411')), planRole: 'unit' };
  const anotherUnit = { ...await file(await png('#1144bb')), planRole: 'unit' };
  const floor = { ...await file(await png('#555555')), planRole: 'floor' };
  const anotherFloor = { ...await file(await png('#111111')), planRole: 'floor' };
  assert.equal(await prepareApartmentLayout(apartment, [floor]), null);
  assert.equal(await sameApartmentLayout(apartment, [unit, floor], apartment, [unit, anotherFloor]), true);
  assert.equal(await sameApartmentLayout(apartment, [unit, floor], apartment, [unit, anotherUnit, anotherFloor]), false);
  assert.equal(await sameApartmentLayout(apartment, [unit, floor], apartment, [unit, { ...anotherFloor, planRole: null }]), false);
});

test('real unit plans allow only faint label rendering differences at the same area and room count', async t => {
  const file = await fixture(t);
  const image = async (name: string) => ({ ...await file(await readFile(new URL(`./fixtures/unit-plans/${name}.webp`, import.meta.url))), planRole: 'unit' });
  const first = await image('45-13-upper'), duplicate = await image('45-13-second'), other = await image('45-16');
  const source = { ...apartment, area: 45.13, bedrooms: 1 };
  assert.notEqual(await prepareApartmentLayout(source, [first]), await prepareApartmentLayout(source, [duplicate]));
  assert.equal(await sameApartmentLayout(source, [first], source, [duplicate]), true);
  assert.equal(await sameApartmentLayout(source, [first], source, [other]), false);
  assert.equal(await sameApartmentLayout(source, [first], { ...source, area: 45.16 }, [duplicate]), false);
  assert.equal(await sameApartmentLayout(source, [first], { ...source, bedrooms: 2 }, [duplicate]), false);
  assert.equal(await sameApartmentLayout(source, [first], source, [{ ...duplicate, planRole: null }]), false);
  assert.equal(await sameApartmentLayout(source, [first], { ...source, layoutHash: '' }, [duplicate]), false);
  // A small real wall change must fail even when the overall pixel difference is very low.
  const changed = { ...await file(await sharp(await readFile(new URL('./fixtures/unit-plans/45-13-upper.webp', import.meta.url)))
    .composite([{ input: await sharp({ create: { width: 2, height: 24, channels: 3, background: '#000' } }).png().toBuffer(), left: 30, top: 30 }]).png().toBuffer()), planRole: 'unit' };
  assert.equal(await sameApartmentLayout(source, [first], source, [changed]), false);
  assert.equal(await sameApartmentLayout(source, [first, other], source, [other, duplicate]), true);
});

test('unit-plan fallback finds the oldest compatible card and rejects conflicting local complexes', async t => {
  const file = await fixture(t);
  const original = { ...await file(await readFile(new URL('./fixtures/unit-plans/45-13-upper.webp', import.meta.url))), planRole: 'unit' };
  const incoming = { ...await file(await readFile(new URL('./fixtures/unit-plans/45-13-second.webp', import.meta.url))), planRole: 'unit' };
  const source = { ...apartment, area: 45.13, bedrooms: 1 };
  const hash = await prepareApartmentLayout(source, [incoming]);
  const exact = { ...source, id: 'newer', complexId: 'local', createdAt: new Date('2026-11-02'), layoutHash: hash, images: [incoming] };
  const previous = { ...source, id: 'oldest', complexId: 'local', createdAt: new Date('2026-11-01'),
    images: [original], layoutHash: await prepareApartmentLayout(source, [original]) };
  const tx = { imageFingerprint: db.imageFingerprint, property: { findMany: async ({ where }: any) => typeof where.layoutHash === 'string' ? [exact] : [previous] } } as any;
  assert.equal((await findApartmentLayout(tx, source, hash!, undefined, [incoming]))?.id, 'oldest');
  previous.complexId = 'other';
  assert.equal(await findApartmentLayout(tx, source, hash!, undefined, [incoming]), null);
});

test('cached exact layout hashes are rechecked against the complete current gallery before import', async t => {
  const file = await fixture(t), unit = { ...await file(await png('#bb4411')), planRole: 'unit' };
  const other = { ...await file(await png('#1144bb')), planRole: 'unit' };
  const floor = { ...await file(await png('#555555')), planRole: 'floor' };
  const hash = await prepareApartmentLayout(apartment, [unit, floor]);
  const candidate = { ...apartment, id: 'existing', layoutHash: hash, images: [unit, floor] };
  const tx = { imageFingerprint: db.imageFingerprint, property: { findMany: async () => [candidate] } } as any;
  assert.equal((await findApartmentLayout(tx, apartment, hash!, undefined, [unit]))?.id, candidate.id);
  for (const changed of [[floor], [other, floor], [unit, other, floor]]) {
    candidate.images = changed;
    assert.equal(await findApartmentLayout(tx, apartment, hash!, undefined, [unit]), null);
  }
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

test('layout matching requires a known complex or numbered address and refuses conflicting local complexes', async () => {
  assert.equal(layoutScopeWhere({ type: 'apartment', housingMarket: 'newbuild' }), null);
  assert.equal(layoutScopeWhere({ ...apartment, housingMarket: 'secondary' }), null);
  let queries = 0;
  const candidates = [{ ...apartment, id: 'first', complexId: 'local-a' }, { ...apartment, id: 'second', complexId: 'local-b' }];
  const tx = { property: { findMany: async () => { queries++; return candidates; } } } as any;
  assert.equal(await findApartmentLayout(tx, { type: 'apartment', housingMarket: 'newbuild' }, 'hash'), null);
  assert.equal(queries, 0);
  assert.equal(await findApartmentLayout(tx, apartment, 'hash'), null);
  candidates[1]!.complexId = 'local-a';
  assert.equal((await findApartmentLayout(tx, apartment, 'hash'))?.id, 'first');
});

test('unlinked apartments compare normalized city and numbered address within the same market', async () => {
  const source = { type: 'apartment', housingMarket: 'newbuild', location: 'г. Калининград', address: 'Тестовая, 1' };
  const same = { ...source, location: 'Калининград', address: 'тестовая 1' };
  assert.ok(layoutScopeWhere(source));
  assert.equal(sameApartmentLayoutScope(source, same), true);
  for (const change of [{ address: 'Тестовая, 2' }, { location: 'Москва' }, { address: 'Тестовая' },
    { housingMarket: 'secondary' }, { complexId: 'local' }, { nmarketComplexId: '71' }]) {
    assert.equal(sameApartmentLayoutScope(source, { ...same, ...change }), false);
  }
  const secondary = { ...source, housingMarket: 'secondary' };
  assert.ok(layoutScopeWhere(secondary));
  assert.equal(layoutScopeWhere(secondary, 'local'), null);
  assert.equal(sameApartmentLayoutScope(secondary, { ...secondary, rf39BuildingId: '1' }), false);
  const unknownCity = { ...source, location: 'Уточняется' };
  assert.equal(layoutScopeWhere(unknownCity), null);
  assert.equal(sameApartmentLayoutScope(unknownCity, unknownCity), false);
  const candidates = [{ ...same, id: 'other', address: 'Тестовая, 2' }, { ...same, id: 'match' }];
  const tx = { property: { findMany: async () => candidates } } as any;
  assert.equal((await findApartmentLayout(tx, source, 'same-image-hash'))?.id, 'match');
});

test('unlinked secondary identity compares the entire gallery, not one common plan or photo', async t => {
  const file = await fixture(t), bytes = await png('#bb4411');
  const photo = await file(bytes, 'photo'), duplicate = await file(await sharp(bytes).withMetadata().png().toBuffer(), 'photo');
  const plan = await file(await png('#555555')), other = await file(await png('#1144bb'), 'photo');
  const source = { type: 'apartment', housingMarket: 'secondary', location: 'Калининград', address: 'Тестовая, 1' };
  const hash = await prepareApartmentLayout(source, [photo, plan]);
  assert.ok(hash);
  assert.equal(await prepareApartmentLayout(source, [plan, duplicate, photo]), hash);
  assert.notEqual(await prepareApartmentLayout(source, [other, plan]), hash);
  assert.notEqual(await prepareApartmentLayout(source, [photo]), hash);
  assert.notEqual(await prepareApartmentLayout(source, [plan]), await prepareApartmentLayout(apartment, [plan]));
  assert.equal(await prepareApartmentLayout(source, []), null);
  t.mock.method(console, 'warn', () => {});
  assert.equal(await prepareApartmentLayout(source, [photo, { kind: 'photo', file: '/uploads/missing.webp' }]), null);
  assert.equal(await prepareApartmentLayout({ ...source, layoutHash: '' }, [photo]), null);
  assert.equal(await prepareApartmentLayout({ ...source, layoutHash: null,
    sourceNote: 'Не удалось загрузить фотографию №2. Она пропущена.' }, [photo]), null);
});
