import { randomUUID } from 'node:crypto';
import { createError, isError } from 'h3';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { prepareImportImages } from './import-images';
import { lockPropertyRelations } from './property-relations';
import { findImportSourceProperty, saveImportSources, type ImportSource } from './import-sources';
import type { nmarketDraft } from './nmarket-data';
import type { rf39Draft } from './rf39-data';
import { importInfrastructureError, type ImportExecution } from './import-execution';
import { rf39FeedBaseline } from '../../shared/rf39-feed-merge';

type Draft = ReturnType<typeof nmarketDraft> | ReturnType<typeof rf39Draft>;

async function checkTarget(tx: Prisma.TransactionClient, complexId?: string) {
  if (!complexId) return;
  const target = await tx.property.findUnique({ where: { id: complexId }, select: { type: true } });
  if (target?.type !== 'complex') throw createError({ statusCode: 400, data: { message: 'Выберите существующий ЖК.' } });
}

async function findExisting(tx: Prisma.TransactionClient, sources: ImportSource[], complexId?: string) {
  const previous = await findImportSourceProperty(tx, sources);
  if (!previous) return null;
  if (complexId && previous.type !== 'apartment')
    throw createError({ statusCode: 400, data: { message: 'К ЖК можно привязать только квартиру.' } });
  if (complexId && previous.complexId && previous.complexId !== complexId)
    throw createError({ statusCode: 409, data: { message: 'Эта квартира уже связана с другим ЖК. Измените привязку вручную в её карточке.' } });
  const linked = !!complexId && previous.complexId !== complexId;
  if (linked) await tx.property.update({ where: { id: previous.id }, data: { complexId } });
  await saveImportSources(tx, previous.id, sources);
  return { id: previous.id, created: false, linked, warnings: previous.sourceId !== sources[0]?.sourceId
    ? ['Квартира уже есть на сайте. Сохранена существующая карточка и её ручные правки.'] : [] as string[] };
}

export async function existingImportedProperty(sourceId: string, complexId?: string, sources: ImportSource[] = [], execution?: ImportExecution) {
  return db.$transaction(async tx => {
    await execution?.guard(tx);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sourceId}))`;
    await lockPropertyRelations(tx);
    await checkTarget(tx, complexId);
    const result = await findExisting(tx, sources.length ? sources : [{ sourceId }], complexId);
    if (result) await execution?.complete?.(tx, result);
    return result;
  });
}

export async function importProperty(draft: Draft, complexId?: string, detectPlans = false, sources: ImportSource[] = [{ sourceId: draft.data.sourceId }], execution?: ImportExecution) {
  if (complexId && draft.data.type !== 'apartment')
    throw createError({ statusCode: 400, data: { message: 'К ЖК можно привязать только квартиру.' } });
  const existing = await existingImportedProperty(draft.data.sourceId, complexId, sources, execution);
  if (existing) return existing;
  try {
    const { images, warnings } = await prepareImportImages(draft, detectPlans);
    draft.warnings.push(...warnings);
    const result = await db.$transaction(async tx => {
      await execution?.guard(tx);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${draft.data.sourceId}))`;
      await lockPropertyRelations(tx);
      await checkTarget(tx, complexId);
      const previous = await findExisting(tx, sources, complexId);
      if (previous) {
        await execution?.complete?.(tx, previous);
        return previous;
      }
      const property = await tx.property.create({ data: {
        ...draft.data, complexId: complexId || null,
        ...(draft.data.sourceId.startsWith('rf39:') ? { rf39Baseline: rf39FeedBaseline(draft.data) as Prisma.InputJsonValue } : {}),
        slug: await tx.property.findUnique({ where: { slug: draft.data.slug } }) ? `${draft.data.slug}-${randomUUID().slice(0, 8)}` : draft.data.slug,
        sourceNote: [`Копия из ${draft.data.sourceName}. Проверьте цену, наличие и характеристики${draft.data.published ? '.' : ' перед публикацией.'}`, ...draft.warnings].join('\n'),
        images: { create: images },
      }, select: { id: true } });
      await saveImportSources(tx, property.id, sources);
      const result = { id: property.id, created: true, linked: !!complexId, warnings: draft.warnings };
      await execution?.complete?.(tx, result);
      return result;
    });
    return result;
  } catch (error) {
    if (importInfrastructureError(error)) throw error;
    if (isError(error) && [400, 409].includes(error.statusCode) && error.data && typeof error.data === 'object' && 'message' in error.data) throw error;
    throw createError({ statusCode: 502, data: { message: 'Не удалось перенести объект или его фотографии. Новая карточка не создана. Повторите импорт.' } });
  }
}
