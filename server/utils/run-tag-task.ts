import type { Prisma } from "@prisma/client";
import { createError } from "h3";
import { db } from './db';
import { tagInclude } from './tag-definitions';
import { assignTagTargets, emptyTagAssignmentSummary } from './tag-assignments';
import { lockPropertyRelations } from './property-relations';
import {
  matchesTagTaskParameters,
  type TagTaskParameter,
  type TagTaskType,
} from "../../shared/tag-task";

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
    throw createError({ statusCode: 500, statusMessage: 'Invalid task type' });
  const tag = await db.tag.findUnique({ where: { id: task.tagId }, include: tagInclude });
  if (!tag) throw createError({ statusCode: 404, statusMessage: 'Tag not found' });
  if (tag.propertyFeature && task.type === 'article')
    throw createError({ statusCode: 400, data: { message: 'Значки характеристик нельзя назначать статьям.' } });
  const params = parseParameters(task.params);
  const targets = task.type === 'article'
    ? await db.article.findMany({ select: { id: true, title: true, content: true } })
    : await db.property.findMany({ where: { type: task.type }, select: {
      id: true, title: true, location: true, description: true, developer: true, sourceId: true, price: true, finish: true,
    } });
  const ids = targets.filter(target => matchesTagTaskParameters(target, params)).map(target => target.id);
  const summary = emptyTagAssignmentSummary();
  const batchSize = tag.propertyFeature ? 50 : 500;
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const batch = ids.slice(offset, offset + batchSize);
    const result = await db.$transaction(async tx => {
      await lockPropertyRelations(tx);
      const currentTag = await tx.tag.findUnique({ where: { id: task.tagId }, include: tagInclude });
      if (!currentTag) throw createError({ statusCode: 404, statusMessage: 'Tag not found' });
      return assignTagTargets(tx, currentTag, task.type === 'article' ? [] : batch, task.type === 'article' ? batch : [], 'rule');
    }, { timeout: 30_000 });
    summary.propertyRelationsCreated += result.propertyRelationsCreated;
    summary.articleRelationsCreated += result.articleRelationsCreated;
    summary.badgesAssigned += result.badgesAssigned;
    summary.skippedCount += result.skippedCount;
    for (const reason of ['secondary', 'heatingConflict', 'clearedGroup', 'limit'] as const) summary.skipped[reason] += result.skipped[reason];
  }
  return { matchedCount: ids.length, assignedCount: summary.propertyRelationsCreated + summary.articleRelationsCreated, ...summary };
}
