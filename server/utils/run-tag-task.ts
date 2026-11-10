import type { Prisma } from "@prisma/client";
import { createError } from "h3";
import {
  matchesTagTaskParameters,
  type TagTaskParameter,
  type TagTaskType,
} from "~/shared/tag-task";

type StoredTagTask = {
  type: string;
  params: Prisma.JsonValue;
  tagId: string;
};

function isTagTaskType(value: string): value is TagTaskType {
  return value === "complex" || value === "apartment" || value === "article";
}

function parseParameters(value: Prisma.JsonValue): TagTaskParameter[] {
  if (!Array.isArray(value))
    throw createError({
      statusCode: 500,
      statusMessage: "Invalid task parameters",
    });
  return value.map((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      !("param" in item) ||
      typeof item.param !== "string" ||
      !("value_contain" in item) ||
      typeof item.value_contain !== "string"
    )
      throw createError({
        statusCode: 500,
        statusMessage: "Invalid task parameters",
      });
    return { param: item.param, value_contain: item.value_contain };
  });
}

export async function runTagTask(task: StoredTagTask) {
  if (!isTagTaskType(task.type))
    throw createError({ statusCode: 500, statusMessage: "Invalid task type" });

  const params = parseParameters(task.params);
  if (task.type === "article") {
    const articles = await db.article.findMany({
      select: { id: true, title: true, content: true },
    });
    const matches = articles.filter((article) =>
      matchesTagTaskParameters(article, params),
    );
    return {
      matchedCount: matches.length,
      assignedCount: await createTagRelations(
        matches.map((article) => ({
          tagId: task.tagId,
          articleId: article.id,
        })),
      ),
    };
  }

  const properties = await db.property.findMany({
    where: { type: task.type },
    select: {
      id: true,
      title: true,
      location: true,
      description: true,
      developer: true,
      sourceId: true,
      price: true,
      finish: true,
    },
  });
  const matches = properties.filter((property) =>
    matchesTagTaskParameters(property, params),
  );
  return {
    matchedCount: matches.length,
    assignedCount: await createTagRelations(
      matches.map((property) => ({
        tagId: task.tagId,
        propertyId: property.id,
      })),
    ),
  };
}

async function createTagRelations(
  relations: Prisma.TagRelationCreateManyInput[],
): Promise<number> {
  let assignedCount = 0;
  for (let offset = 0; offset < relations.length; offset += 500) {
    const result = await db.tagRelation.createMany({
      data: relations.slice(offset, offset + 500),
      skipDuplicates: true,
    });
    assignedCount += result.count;
  }
  return assignedCount;
}
