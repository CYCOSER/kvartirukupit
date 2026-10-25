import test from 'node:test';
import assert from 'node:assert/strict';
import type { Prisma } from '@prisma/client';
import { propertySchema } from '../shared/property';
import { validatePropertyRelation } from '../server/utils/property-relations';

const apartment = propertySchema.parse({
  title: 'Квартира для проверки', slug: 'relation-test', type: 'apartment', location: 'Калининград',
  price: null, status: 'available', area: null, landArea: null, bedrooms: null, floors: null,
  readiness: 'Уточняется', finish: 'Уточняется', description: '', utilities: [],
  published: false, featured: false, demo: false,
});
const tx = (targetType: string | null, children = 0) => ({ property: {
  findUnique: async () => targetType ? { type: targetType } : null,
  count: async () => children,
} }) as unknown as Prisma.TransactionClient;

test('relationship input distinguishes old clients from explicit unlink and validates source IDs', () => {
  assert.equal('complexId' in apartment, false);
  assert.equal(propertySchema.parse({ ...apartment, complexId: null }).complexId, null);
  assert.equal(propertySchema.safeParse({ ...apartment, type: 'complex', complexId: 'parent' }).success, false);
  assert.equal(propertySchema.parse({ ...apartment, nmarketComplexId: ' 103-A ', rf39ComplexId: null }).nmarketComplexId, '103-A');
  assert.equal(propertySchema.parse({ ...apartment, rf39BuildingId: ' 21482 ' }).rf39BuildingId, '21482');
  for (const id of ['', '../wrong', 'https://crm.example/object/2', 'a'.repeat(101)]) {
    assert.equal(propertySchema.safeParse({ ...apartment, rf39ComplexId: id }).success, false);
    assert.equal(propertySchema.safeParse({ ...apartment, rf39BuildingId: id }).success, false);
  }
});

test('relationships require a real complex and prevent self links and converting a parent with children', async () => {
  const child = { ...apartment, complexId: 'parent' };
  await validatePropertyRelation(tx('complex'), child);
  await assert.rejects(validatePropertyRelation(tx(null), child), /существующий жилой комплекс/);
  await assert.rejects(validatePropertyRelation(tx('apartment'), child), /существующий жилой комплекс/);
  await assert.rejects(validatePropertyRelation(tx('complex'), child, { id: 'parent', complexId: null }), /только квартиру/);
  await assert.rejects(validatePropertyRelation(tx('complex', 1), apartment, { id: 'parent', complexId: null }), /Сначала отвяжите/);
  await validatePropertyRelation(tx('complex', 1), { ...apartment, type: 'complex' }, { id: 'parent', complexId: null });
});

test('omitted relationship is preserved on update while explicit null allows unlinking', async () => {
  const existing = { id: 'child', complexId: 'parent' };
  await validatePropertyRelation(tx('complex'), apartment, existing);
  assert.equal(apartment.complexId, undefined);
  await assert.rejects(validatePropertyRelation(tx('complex'), { ...apartment, type: 'complex' }, existing), /только квартиру/);
  await validatePropertyRelation(tx('complex'), { ...apartment, type: 'complex', complexId: null }, existing);
});
