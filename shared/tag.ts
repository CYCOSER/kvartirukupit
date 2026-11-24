import { z } from "zod";
import { propertyFeatureSchema, type PropertyFeature } from './property-feature';

export const tagSchema = z.object({
  name: z.string().trim().min(1).max(120),
  propertyFeature: propertyFeatureSchema.strict().nullable().optional(),
}).strict();
export const tagUpdateSchema = tagSchema.extend({
  propertyFeature: propertyFeatureSchema.pick({ name: true }).strict().nullable().optional(),
});
export type Tag = { id: string; name: string; propertyFeature: PropertyFeature | null };
export type TagAssignmentSummary = {
  propertyRelationsCreated: number;
  articleRelationsCreated: number;
  badgesAssigned: number;
  skippedCount: number;
  skipped: { secondary: number; heatingConflict: number; clearedGroup: number; limit: number };
};

export const manualTagRelationsSchema = z
  .object({
    tag_id: z.string().min(1).max(100),
    property_ids: z.array(z.string().min(1).max(100)).max(500),
    article_ids: z.array(z.string().min(1).max(100)).max(500),
  })
  .refine(
    ({ property_ids, article_ids }) =>
      property_ids.length > 0 || article_ids.length > 0,
    "At least one property or article is required",
  );

export type TagInput = z.infer<typeof tagSchema>;
export type ManualTagRelationsInput = z.infer<typeof manualTagRelationsSchema>;

export function combineTagKeywords(
  existingKeywords: string,
  tagNames: readonly string[],
): string {
  const keywords = [...existingKeywords.split(","), ...tagNames]
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  return keywords
    .filter((keyword) => {
      const normalized = keyword.toLocaleLowerCase("ru-RU");
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .join(", ");
}
