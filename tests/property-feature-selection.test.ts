import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { propertyFeatureSchema, validateFeatureSelection, type PropertyFeature } from '../shared/property-feature';
import { validatePropertyFeatureSelection } from '../server/utils/property-features';

const features: PropertyFeature[] = [
  { id: 'gas', name: 'Газовое', group: 'heating' },
  { id: 'central', name: 'Центральное', group: 'heating' },
  { id: 'sea', name: 'У моря', group: 'location' },
];
const tx = { propertyFeature: { findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
  features.filter(feature => where.id.in.includes(feature.id)),
} } as unknown as Prisma.TransactionClient;

test('dictionary schema trims labels and rejects unknown groups and empty labels', () => {
  assert.deepEqual(propertyFeatureSchema.parse({ name: ' Терраса ', group: 'other' }), { name: 'Терраса', group: 'other' });
  for (const input of [{ name: '', group: 'other' }, { name: ' ', group: 'other' }, { name: 'x'.repeat(121), group: 'other' }, { name: 'Терраса', group: 'unknown' }])
    assert.equal(propertyFeatureSchema.safeParse(input).success, false);
});

test('selection requires local group overrides and accepts explicit empty groups', () => {
  assert.equal(validateFeatureSelection([features[0]!, features[2]!], ['heating', 'location']), null);
  assert.equal(validateFeatureSelection([], ['territory', 'location']), null);
  assert.ok(validateFeatureSelection([features[0]!], []));
  assert.ok(validateFeatureSelection(features.slice(0, 2), ['heating']));
});

test('server rejects missing dictionary entries and incompatible heating selections', async () => {
  await validatePropertyFeatureSelection(tx, { featureIds: ['gas', 'sea'], featureOverrides: ['heating', 'location'] });
  await assert.rejects(validatePropertyFeatureSelection(tx, { featureIds: ['removed'], featureOverrides: ['other'] }), { statusCode: 400 });
  await assert.rejects(validatePropertyFeatureSelection(tx, { featureIds: ['gas', 'central'], featureOverrides: ['heating'] }), { statusCode: 400 });
  await assert.rejects(validatePropertyFeatureSelection(tx, { featureIds: ['sea'], featureOverrides: [] }), { statusCode: 400 });
});

test('omitted feature fields preserve previous selections while clearing can suppress inheritance', async () => {
  const previous = { features: [features[2]!], featureOverrides: ['location' as const] };
  await validatePropertyFeatureSelection(tx, {}, previous);
  await validatePropertyFeatureSelection(tx, { featureIds: [] }, previous);
  await validatePropertyFeatureSelection(tx, { featureIds: [], featureOverrides: [] }, previous);
  await assert.rejects(validatePropertyFeatureSelection(tx, { featureOverrides: [] }, previous), { statusCode: 400 });
});
