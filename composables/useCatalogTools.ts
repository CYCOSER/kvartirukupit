import { z } from "zod";
export function useCatalogTools(
  apply: (filters: Record<string, string>) => Promise<unknown>,
) {
  let lifecycle: AbortController | undefined;
  onMounted(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => unknown;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    lifecycle = new AbortController();
    const schema = z
      .object({
        type: z.enum(["complex", "apartment"]).optional(),
        location: z.string().max(150).optional(),
        maxPrice: z.number().nonnegative().optional(),
        minArea: z.number().nonnegative().optional(),
        bedrooms: z.number().int().min(0).max(100).optional(),
      })
      .strict();
    try {
      Promise.resolve(
        context.registerTool(
          {
            name: "filter_apartment_catalog",
            title: "Подобрать недвижимость",
            description:
              "Apply catalog filters and show matching published available properties. Does not submit a request.",
            inputSchema: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: ["complex", "apartment"],
                },
                location: { type: "string" },
                maxPrice: { type: "number", minimum: 0 },
                minArea: { type: "number", minimum: 0 },
                bedrooms: { type: "integer", minimum: 0, maximum: 100 },
              },
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: true },
            execute: async (input: unknown) =>
              apply(
                Object.fromEntries(
                  Object.entries(schema.parse(input)).map(([k, v]) => [
                    k,
                    String(v),
                  ]),
                ),
              ),
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}
  });
  onUnmounted(() => lifecycle?.abort());
}
