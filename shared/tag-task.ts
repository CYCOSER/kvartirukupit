import { z } from "zod";

export const tagTaskTypes = ["complex", "apartment", "article"] as const;
export type TagTaskType = (typeof tagTaskTypes)[number];

export const tagTaskTypeLabels: Record<TagTaskType, string> = {
  complex: "ЖК",
  apartment: "Квартира",
  article: "Статья",
};

export const tagTaskFields = {
  complex: [
    { value: "title", label: "Название" },
    { value: "location", label: "Местоположение" },
    { value: "description", label: "Описание" },
    { value: "developer", label: "Застройщик" },
    { value: "sourceId", label: "Источник" },
  ],
  apartment: [
    { value: "location", label: "Местоположение" },
    { value: "price", label: "Цена" },
    { value: "finish", label: "Отделка" },
  ],
  article: [
    { value: "title", label: "Заголовок" },
    { value: "content", label: "Текст" },
  ],
} as const satisfies Record<
  TagTaskType,
  readonly { value: string; label: string }[]
>;

export const tagTaskParamsSchema = z
  .array(
    z.object({
      param: z.string().min(1),
      value_contain: z.string().trim().min(1).max(200),
    }),
  )
  .min(1)
  .max(20);

export const tagTaskSchema = z
  .object({
    type: z.enum(tagTaskTypes),
    tag_id: z.string().min(1).max(100),
    params: tagTaskParamsSchema,
  })
  .superRefine((task, context) => {
    const allowed = tagTaskFields[task.type];
    task.params.forEach((parameter, index) => {
      if (!allowed.some((field) => field.value === parameter.param))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["params", index, "param"],
          message: "Parameter is not allowed for this task type",
        });
    });
  });

export type TagTaskInput = z.infer<typeof tagTaskSchema>;
export type TagTaskParameter = z.infer<typeof tagTaskParamsSchema>[number];

export function matchesTagTaskParameters(
  item: Record<string, unknown>,
  params: TagTaskParameter[],
): boolean {
  return params.every(({ param, value_contain }) => {
    const value = item[param];
    if (value === null || value === undefined) return false;
    return String(value)
      .toLocaleLowerCase("ru-RU")
      .includes(value_contain.toLocaleLowerCase("ru-RU"));
  });
}
