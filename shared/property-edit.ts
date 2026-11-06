import { z } from 'zod';
import { propertySchema, type PropertyInput } from './property';

export const propertyEditFields = [
  'title', 'slug', 'type', 'housingMarket', 'complexId', 'nmarketComplexId', 'rf39ComplexId', 'rf39BuildingId',
  'location', 'address', 'latitude', 'longitude', 'price', 'status', 'area', 'landArea', 'bedrooms', 'floors', 'availableFloors',
  'readiness', 'finish', 'seaDistance', 'description', 'utilities', 'published', 'featured', 'elite', 'demo',
] as const satisfies readonly (keyof PropertyInput)[];
export type PropertyEditField = typeof propertyEditFields[number];
const metadataSchema = z.object({ changedFields: z.array(z.enum(propertyEditFields)).max(propertyEditFields.length).optional() });

export function changedPropertyFields(previous: PropertyInput, current: PropertyInput): PropertyEditField[] {
  const fields = propertyEditFields.filter(field => JSON.stringify(previous[field]) !== JSON.stringify(current[field]));
  // A type change also clears relations and flags that may have changed on the server.
  if (fields.includes('type')) return [...new Set<PropertyEditField>([...fields, 'elite', 'complexId', 'housingMarket', 'availableFloors'])];
  return fields;
}

export function parsePropertyUpdate(input: unknown) {
  const data = propertySchema.parse(input);
  const { changedFields } = metadataSchema.parse(input);
  if (changedFields?.some(field => !Object.prototype.hasOwnProperty.call(input, field)))
    throw new z.ZodError([{ code: 'custom', path: ['changedFields'], message: 'Missing changed field value' }]);
  return { data, changedFields };
}

export function mergePropertyUpdate(current: object, update: ReturnType<typeof parsePropertyUpdate>) {
  return update.changedFields
    ? propertySchema.parse({ ...current, ...Object.fromEntries(update.changedFields.map(field => [field, update.data[field]])) })
    : update.data;
}
