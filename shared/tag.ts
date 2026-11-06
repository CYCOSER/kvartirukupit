import { z } from "zod";

export const tagSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export type TagInput = z.infer<typeof tagSchema>;
