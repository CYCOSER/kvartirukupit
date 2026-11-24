import { z } from 'zod';

export const propertyFeatureGroups = ['heating', 'territory', 'location', 'other'] as const;
export const propertyFeatureGroupLabels = {
  heating: 'Отопление',
  territory: 'Территория',
  location: 'Локация',
  other: 'Другие значки',
} as const;
export const propertyFeatureGroupSchema = z.enum(propertyFeatureGroups);
export type PropertyFeatureGroup = z.infer<typeof propertyFeatureGroupSchema>;
export const propertyFeatureSchema = z.object({
  name: z.string().trim().min(1).max(120),
  group: propertyFeatureGroupSchema,
});
export type PropertyFeature = z.infer<typeof propertyFeatureSchema> & { id: string };

export function validateFeatureSelection(features: readonly PropertyFeature[], overrides: readonly PropertyFeatureGroup[]) {
  if (features.some(feature => !overrides.includes(feature.group)))
    return 'Для выбранных значков укажите собственные значения группы.';
  if (features.filter(feature => feature.group === 'heating').length > 1)
    return 'Выберите только один тип отопления.';
  return null;
}
