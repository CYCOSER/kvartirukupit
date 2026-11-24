import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Prisma } from '@prisma/client';
import type { PropertyFeature, PropertyFeatureGroup } from '../shared/property-feature';
import type { Tag } from '../shared/tag';
import { assignTagTargets, syncPropertyFeatureTags } from '../server/utils/tag-assignments';

const gas: PropertyFeature = { id: 'gas', name: 'Газовое', group: 'heating' };
const central: PropertyFeature = { id: 'central', name: 'Центральное', group: 'heating' };
const sea: PropertyFeature = { id: 'sea', name: 'У моря', group: 'location' };
const park: PropertyFeature = { id: 'park', name: 'У парка', group: 'location' };
const country: PropertyFeature = { id: 'country', name: 'За городом', group: 'location' };
const fence: PropertyFeature = { id: 'fence', name: 'Огороженная территория', group: 'territory' };
const terrace: PropertyFeature = { id: 'terrace', name: 'Терраса', group: 'other' };
const features = [gas, central, sea, park, country, fence, terrace];
const ordinary: Tag = { id: 'ordinary-tag', name: 'Новости', propertyFeature: null };
const badgeTag = (feature: PropertyFeature): Tag => ({ id: `tag-${feature.id}`, name: feature.name, propertyFeature: feature });
const tags = [ordinary, ...features.map(badgeTag)];
type Selection = { tagId: string; propertyId?: string; articleId?: string };
type Property = {
  id: string;
  type: 'complex' | 'apartment';
  housingMarket: 'newbuild' | 'secondary' | null;
  features: PropertyFeature[];
  featureOverrides: PropertyFeatureGroup[];
  complex: { features: PropertyFeature[] } | null;
};
const property = (values: Partial<Property> = {}): Property => ({
  id: 'property', type: 'apartment', housingMarket: 'newbuild',
  features: [], featureOverrides: [], complex: null, ...values,
});

function fixture(t: TestContext, properties: Property[] = [], selected: Selection[] = []) {
  const relations = selected.map(item => ({ ...item }));
  const update = t.mock.fn(async ({ where, data }: any) => {
    const item = properties.find(value => value.id === where.id)!;
    item.features = data.features.set.map(({ id }: { id: string }) => features.find(feature => feature.id === id)!);
    item.featureOverrides = data.featureOverrides;
    return item;
  });
  const findProperties = t.mock.fn(async ({ where }: any) => properties.filter(item => where.id.in.includes(item.id)));
  const create = t.mock.fn(async ({ data }: { data: Selection[] }) => {
    let count = 0;
    for (const item of data) {
      if (relations.some(current => current.tagId === item.tagId && current.propertyId === item.propertyId && current.articleId === item.articleId)) continue;
      relations.push({ ...item });
      count++;
    }
    return { count };
  });
  const remove = t.mock.fn(async ({ where }: any) => {
    let count = 0;
    for (let index = relations.length - 1; index >= 0; index--) {
      const item = relations[index]!;
      if (where.propertyId !== undefined && item.propertyId !== where.propertyId) continue;
      if (where.tag?.propertyFeatureId?.not === null && !tags.find(tag => tag.id === item.tagId)?.propertyFeature) continue;
      if (where.tagId?.notIn?.includes(item.tagId)) continue;
      relations.splice(index, 1);
      count++;
    }
    return { count };
  });
  const tx = {
    property: { findMany: findProperties, update },
    tag: { findMany: async ({ where }: any) => tags.filter(tag => tag.propertyFeature && where.propertyFeatureId.in.includes(tag.propertyFeature.id)).map(({ id }) => ({ id })) },
    tagRelation: { createMany: create, deleteMany: remove },
  } as unknown as Prisma.TransactionClient;
  return { tx, properties, relations, update, findProperties, create, remove };
}

test('ordinary tags assign properties and articles without changing badges, with duplicate-safe retries', async t => {
  const f = fixture(t, [property()]);
  const first = await assignTagTargets(f.tx, ordinary, ['property'], ['article'], 'manual');
  assert.equal(first.propertyRelationsCreated, 1);
  assert.equal(first.articleRelationsCreated, 1);
  assert.equal(first.badgesAssigned, 0);
  assert.equal(first.skippedCount, 0);
  const repeated = await assignTagTargets(f.tx, ordinary, ['property'], ['article'], 'rule');
  assert.equal(repeated.propertyRelationsCreated, 0);
  assert.equal(repeated.articleRelationsCreated, 0);
  assert.deepEqual(f.relations, [
    { tagId: ordinary.id, propertyId: 'property' },
    { tagId: ordinary.id, articleId: 'article' },
  ]);
  assert.equal(f.findProperties.mock.callCount(), 0);
  assert.equal(f.update.mock.callCount(), 0);
  assert.equal(f.remove.mock.callCount(), 0);
});

test('manual heating replaces the selected heater and removes its old badge tag only', async t => {
  const item = property({ features: [central, sea], featureOverrides: ['heating', 'location'] });
  const f = fixture(t, [item], [
    { tagId: 'tag-central', propertyId: item.id },
    { tagId: 'tag-sea', propertyId: item.id },
    { tagId: ordinary.id, propertyId: item.id },
  ]);
  const summary = await assignTagTargets(f.tx, badgeTag(gas), [item.id], [], 'manual');
  assert.equal(summary.badgesAssigned, 1);
  assert.equal(summary.propertyRelationsCreated, 1);
  assert.deepEqual(item.features.map(feature => feature.id).sort(), ['gas', 'sea']);
  assert.deepEqual(item.featureOverrides, ['heating', 'location']);
  assert.deepEqual(f.relations.map(relation => relation.tagId).sort(), ['ordinary-tag', 'tag-gas', 'tag-sea']);
  assert.equal((await assignTagTargets(f.tx, badgeTag(gas), [item.id], [], 'manual')).badgesAssigned, 0);
  assert.equal(f.update.mock.callCount(), 1);
});

test('rules skip a conflicting heater whether selected locally or inherited', async t => {
  const local = property({ id: 'local', features: [central], featureOverrides: ['heating'] });
  const inherited = property({ id: 'inherited', complex: { features: [central] } });
  const f = fixture(t, [local, inherited]);
  const summary = await assignTagTargets(f.tx, badgeTag(gas), [local.id, inherited.id], [], 'rule');
  assert.equal(summary.skipped.heatingConflict, 2);
  assert.equal(summary.skippedCount, 2);
  assert.equal(summary.badgesAssigned, 0);
  assert.equal(f.update.mock.callCount(), 0);
  assert.equal(f.create.mock.callCount(), 0);
  assert.equal(f.remove.mock.callCount(), 0);
  assert.deepEqual(local.features, [central]);
  assert.deepEqual(inherited.featureOverrides, []);
});

test('an explicitly empty group blocks a rule but permits an explicit manual assignment', async t => {
  const item = property({ features: [gas], featureOverrides: ['heating', 'other'], complex: { features: [terrace] } });
  const f = fixture(t, [item]);
  const skipped = await assignTagTargets(f.tx, badgeTag(terrace), [item.id], [], 'rule');
  assert.equal(skipped.skipped.clearedGroup, 1);
  assert.equal(skipped.skippedCount, 1);
  assert.equal(f.update.mock.callCount(), 0);
  const assigned = await assignTagTargets(f.tx, badgeTag(terrace), [item.id], [], 'manual');
  assert.equal(assigned.badgesAssigned, 1);
  assert.deepEqual(item.features, [gas, terrace]);
  assert.deepEqual(item.featureOverrides, ['heating', 'other']);
});

test('adding a location materializes its inherited group without losing existing or unrelated badges', async t => {
  const item = property({ features: [gas], featureOverrides: ['heating'], complex: { features: [sea, park, fence] } });
  const f = fixture(t, [item], [{ tagId: ordinary.id, propertyId: item.id }]);
  const summary = await assignTagTargets(f.tx, badgeTag(country), [item.id], [], 'manual');
  assert.equal(summary.badgesAssigned, 1);
  assert.equal(summary.propertyRelationsCreated, 1);
  assert.deepEqual(item.features, [gas, sea, park, country]);
  assert.deepEqual(item.featureOverrides, ['heating', 'location']);
  assert.deepEqual(item.complex?.features, [sea, park, fence]);
  assert.deepEqual(f.relations.map(relation => relation.tagId).sort(), ['ordinary-tag', 'tag-country', 'tag-gas', 'tag-park', 'tag-sea']);
});

test('manual and rule assignments skip properties at the badge limit without writing', async t => {
  const selected = Array.from({ length: 200 }, (_, index): PropertyFeature => ({
    id: `existing-${index}`, name: `Значок ${index}`, group: 'other',
  }));
  const item = property({ features: selected, featureOverrides: ['other'] });
  const f = fixture(t, [item]);
  for (const mode of ['manual', 'rule'] as const) {
    const summary = await assignTagTargets(f.tx, badgeTag(terrace), [item.id], [], mode);
    assert.equal(summary.skipped.limit, 1);
    assert.equal(summary.skippedCount, 1);
    assert.equal(summary.badgesAssigned, 0);
    assert.equal(summary.propertyRelationsCreated, 0);
  }
  assert.equal(f.update.mock.callCount(), 0);
  assert.equal(f.create.mock.callCount(), 0);
  assert.equal(f.remove.mock.callCount(), 0);
  assert.deepEqual(item.features, selected);
  assert.deepEqual(item.featureOverrides, ['other']);
});

test('a property at the badge limit does not stop later valid targets in the batch', async t => {
  const limited = property({
    id: 'limited', featureOverrides: ['other'],
    features: Array.from({ length: 200 }, (_, index): PropertyFeature => ({
      id: `existing-${index}`, name: `Значок ${index}`, group: 'other',
    })),
  });
  const valid = property({ id: 'valid' });
  const f = fixture(t, [limited, valid]);
  const summary = await assignTagTargets(f.tx, badgeTag(terrace), [limited.id, valid.id], [], 'manual');
  assert.equal(summary.skipped.limit, 1);
  assert.equal(summary.skippedCount, 1);
  assert.equal(summary.badgesAssigned, 1);
  assert.equal(summary.propertyRelationsCreated, 1);
  assert.equal(limited.features.length, 200);
  assert.deepEqual(valid.features, [terrace]);
  assert.deepEqual(f.update.mock.calls.map(call => call.arguments[0].where.id), [valid.id]);
  assert.deepEqual(f.relations, [{ tagId: 'tag-terrace', propertyId: valid.id }]);
});

test('secondary apartments are skipped in both manual and rule assignments', async t => {
  const item = property({ housingMarket: 'secondary' });
  const f = fixture(t, [item]);
  for (const mode of ['manual', 'rule'] as const) {
    const summary = await assignTagTargets(f.tx, badgeTag(sea), [item.id], [], mode);
    assert.equal(summary.skipped.secondary, 1);
    assert.equal(summary.skippedCount, 1);
    assert.equal(summary.badgesAssigned, 0);
  }
  assert.equal(f.update.mock.callCount(), 0);
  assert.equal(f.create.mock.callCount(), 0);
});

test('badge assignment to articles rejects before changing any selected property', async t => {
  const f = fixture(t, [property()]);
  for (const mode of ['manual', 'rule'] as const) {
    await assert.rejects(assignTagTargets(f.tx, badgeTag(sea), ['property'], ['article'], mode), { statusCode: 400 });
  }
  assert.equal(f.findProperties.mock.callCount(), 0);
  assert.equal(f.update.mock.callCount(), 0);
  assert.equal(f.create.mock.callCount(), 0);
});

test('badge tag synchronization removes only obsolete badge links for the target property', async t => {
  const f = fixture(t, [], [
    { tagId: ordinary.id, propertyId: 'property' },
    { tagId: 'tag-central', propertyId: 'property' },
    { tagId: 'tag-sea', propertyId: 'property' },
    { tagId: 'tag-central', propertyId: 'another' },
    { tagId: 'tag-central', articleId: 'article' },
  ]);
  assert.deepEqual(await syncPropertyFeatureTags(f.tx, 'property', [sea.id]), { count: 0 });
  assert.deepEqual(f.relations, [
    { tagId: ordinary.id, propertyId: 'property' },
    { tagId: 'tag-sea', propertyId: 'property' },
    { tagId: 'tag-central', propertyId: 'another' },
    { tagId: 'tag-central', articleId: 'article' },
  ]);
  assert.deepEqual(await syncPropertyFeatureTags(f.tx, 'property', []), { count: 0 });
  assert.deepEqual(f.relations, [
    { tagId: ordinary.id, propertyId: 'property' },
    { tagId: 'tag-central', propertyId: 'another' },
    { tagId: 'tag-central', articleId: 'article' },
  ]);
});
