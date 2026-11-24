import type { Prisma } from '@prisma/client';
import { createError } from 'h3';
import type { Tag, TagAssignmentSummary } from '../../shared/tag';
import { propertyFeatureSelect } from './property-relations';

export function emptyTagAssignmentSummary(): TagAssignmentSummary {
  return { propertyRelationsCreated: 0, articleRelationsCreated: 0, badgesAssigned: 0, skippedCount: 0,
    skipped: { secondary: 0, heatingConflict: 0, clearedGroup: 0, limit: 0 } };
}

export async function syncPropertyFeatureTags(tx: Prisma.TransactionClient, propertyId: string, featureIds: string[]) {
  const tags = await tx.tag.findMany({ where: { propertyFeatureId: { in: featureIds } }, select: { id: true } });
  await tx.tagRelation.deleteMany({ where: { propertyId, tag: { propertyFeatureId: { not: null } }, tagId: { notIn: tags.map(tag => tag.id) } } });
  return tags.length ? tx.tagRelation.createMany({ data: tags.map(tag => ({ tagId: tag.id, propertyId })), skipDuplicates: true }) : { count: 0 };
}

export async function assignTagTargets(
  tx: Prisma.TransactionClient, tag: Tag, propertyIds: string[], articleIds: string[], mode: 'manual' | 'rule',
): Promise<TagAssignmentSummary> {
  const summary = emptyTagAssignmentSummary();
  if (tag.propertyFeature && articleIds.length)
    throw createError({ statusCode: 400, data: { message: 'Значки характеристик можно назначать только ЖК и квартирам, не статьям.' } });
  if (!tag.propertyFeature) {
    if (propertyIds.length) summary.propertyRelationsCreated = (await tx.tagRelation.createMany({
      data: propertyIds.map(propertyId => ({ tagId: tag.id, propertyId })), skipDuplicates: true,
    })).count;
  } else if (propertyIds.length) {
    const feature = tag.propertyFeature;
    const properties = await tx.property.findMany({ where: { id: { in: propertyIds } }, select: {
      id: true, type: true, housingMarket: true, features: propertyFeatureSelect, featureOverrides: true,
      complex: { select: { features: propertyFeatureSelect } },
    } });
    for (const property of properties) {
      if (property.type === 'apartment' && property.housingMarket === 'secondary') {
        summary.skipped.secondary++; continue;
      }
      const overridden = property.featureOverrides.includes(feature.group);
      const local = property.features.filter(item => item.group === feature.group);
      const effective = !property.complex || overridden ? local : property.complex.features.filter(item => item.group === feature.group);
      if (mode === 'rule' && overridden && !local.length) { summary.skipped.clearedGroup++; continue; }
      if (mode === 'rule' && feature.group === 'heating' && effective.some(item => item.id !== feature.id)) {
        summary.skipped.heatingConflict++; continue;
      }
      const selected = feature.group === 'heating' ? [feature] : [...effective.filter(item => item.id !== feature.id), feature];
      const featureIds = [...property.features.filter(item => item.group !== feature.group), ...selected].map(item => item.id);
      if (featureIds.length > 200) { summary.skipped.limit++; continue; }
      if (!overridden || local.length !== selected.length || selected.some(item => !local.some(own => own.id === item.id))) {
        await tx.property.update({ where: { id: property.id }, data: {
          features: { set: featureIds.map(id => ({ id })) },
          featureOverrides: [...new Set([...property.featureOverrides, feature.group])],
        } });
        summary.badgesAssigned++;
      }
      summary.propertyRelationsCreated += (await tx.tagRelation.createMany({
        data: [{ tagId: tag.id, propertyId: property.id }], skipDuplicates: true,
      })).count;
      await syncPropertyFeatureTags(tx, property.id, featureIds);
    }
  }
  if (articleIds.length) summary.articleRelationsCreated = (await tx.tagRelation.createMany({
    data: articleIds.map(articleId => ({ tagId: tag.id, articleId })), skipDuplicates: true,
  })).count;
  summary.skippedCount = Object.values(summary.skipped).reduce((sum, count) => sum + count, 0);
  return summary;
}
