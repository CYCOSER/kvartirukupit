import { z } from "zod";

export const tagSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export type TagInput = z.infer<typeof tagSchema>;

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
