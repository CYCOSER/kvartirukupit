import type { z } from 'zod';
import { createError } from 'h3';
import type { TagInput, tagUpdateSchema } from '../../shared/tag';
import { db } from './db';
import { lockPropertyRelations } from './property-relations';

export const tagInclude = { propertyFeature: { select: { id: true, name: true, group: true } } } as const;

function definitionError(error: unknown): never {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if (error.code === 'P2002')
      throw createError({ statusCode: 409, data: { message: 'Тег или значок с таким названием уже существует.' } });
    if (error.code === 'P2025')
      throw createError({ statusCode: 404, data: { message: 'Тег или значок не найден.' } });
  }
  throw error;
}

export async function createTagDefinition(input: TagInput) {
  try {
    return await db.$transaction(async tx => {
      await lockPropertyRelations(tx);
      return tx.tag.create({
        data: { name: input.name, ...(input.propertyFeature ? { propertyFeature: { create: input.propertyFeature } } : {}) },
        include: tagInclude,
      });
    });
  } catch (error) { definitionError(error); }
}

export async function updateTagDefinition(id: string, input: z.infer<typeof tagUpdateSchema>) {
  try {
    return await db.$transaction(async tx => {
      await lockPropertyRelations(tx);
      const existing = await tx.tag.findUnique({ where: { id }, include: tagInclude });
      if (!existing) throw createError({ statusCode: 404, data: { message: 'Тег не найден.' } });
      if ((input.propertyFeature && !existing.propertyFeature) || (input.propertyFeature === null && existing.propertyFeature))
        throw createError({ statusCode: 400, data: { message: 'Тип существующего тега менять нельзя.' } });
      return tx.tag.update({
        where: { id },
        data: { name: input.name, ...(input.propertyFeature ? { propertyFeature: { update: input.propertyFeature } } : {}) },
        include: tagInclude,
      });
    });
  } catch (error) { definitionError(error); }
}

export async function deleteTagDefinition(id: string) {
  return db.$transaction(async tx => {
    await lockPropertyRelations(tx);
    const tag = await tx.tag.findUnique({ where: { id }, select: { propertyFeatureId: true } });
    if (!tag) throw createError({ statusCode: 404, data: { message: 'Тег не найден.' } });
    await tx.tag.delete({ where: { id } });
    if (tag.propertyFeatureId) await tx.propertyFeature.delete({ where: { id: tag.propertyFeatureId } });
    return { ok: true };
  });
}

export async function renamePropertyFeature(id: string, name: string) {
  try {
    return await db.$transaction(async tx => {
      await lockPropertyRelations(tx);
      return tx.propertyFeature.update({ where: { id }, data: { name } });
    });
  } catch (error) { definitionError(error); }
}

export async function deletePropertyFeature(id: string) {
  return db.$transaction(async tx => {
    await lockPropertyRelations(tx);
    await tx.tag.deleteMany({ where: { propertyFeatureId: id } });
    const deleted = await tx.propertyFeature.deleteMany({ where: { id } });
    if (!deleted.count) throw createError({ statusCode: 404, data: { message: 'Значок не найден.' } });
    return { ok: true };
  });
}
