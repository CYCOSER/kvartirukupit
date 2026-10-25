import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createError, isError } from 'h3';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { convertUploadedImage, isFloorPlanImage, prepareFloorPlanImage } from './image';
import { rf39ReadBody } from './rf39';
import { lockPropertyRelations } from './property-relations';
import { findImportSourceProperty, saveImportSources, type ImportSource } from './import-sources';
import type { nmarketDraft } from './nmarket-data';
import type { rf39Draft } from './rf39-data';

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

export async function existingImportedProperty(sourceId: string, complexId?: string, sources: ImportSource[] = []) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sourceId}))`;
    await lockPropertyRelations(tx);
    await checkTarget(tx, complexId);
    return findExisting(tx, sources.length ? sources : [{ sourceId }], complexId);
  });
}

export async function importProperty(draft: Draft, complexId?: string, detectPlans = false, sources: ImportSource[] = [{ sourceId: draft.data.sourceId }]) {
  if (complexId && draft.data.type !== 'apartment')
    throw createError({ statusCode: 400, data: { message: 'К ЖК можно привязать только квартиру.' } });
  const existing = await existingImportedProperty(draft.data.sourceId, complexId, sources);
  if (existing) return existing;
  const dir = resolve(process.env.UPLOAD_DIR || '.data/uploads');
  await mkdir(dir, { recursive: true });
  const files: { name: string; originalName: string; hueShift: number; kind: 'photo' | 'plan' }[] = [];
  const writtenFiles: string[] = [];
  let keepFiles = false;
  try {
    for (const url of draft.imageUrls) {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
      const bytes = await rf39ReadBody(response, 10 * 1024 * 1024);
      const floorPlan = draft.planImageUrls.includes(url) || (detectPlans && await isFloorPlanImage(bytes));
      const original = await convertUploadedImage(bytes, response.headers.get('content-type')?.split(';')[0] || '');
      const originalName = randomUUID() + '.webp';
      writtenFiles.push(originalName);
      await writeFile(resolve(dir, originalName), original, { flag: 'wx' });
      let name = originalName, hueShift = 0;
      if (floorPlan) {
        const plan = await prepareFloorPlanImage(original);
        hueShift = plan.hueShift;
        name = randomUUID() + '.webp';
        writtenFiles.push(name);
        await writeFile(resolve(dir, name), plan.buffer, { flag: 'wx' });
      }
      files.push({ name, originalName, hueShift, kind: floorPlan ? 'plan' : 'photo' });
    }
    if (!files.length) draft.warnings.push('В источнике нет доступных фотографий. Добавьте их перед публикацией.');
    const result = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${draft.data.sourceId}))`;
      await lockPropertyRelations(tx);
      await checkTarget(tx, complexId);
      const previous = await findExisting(tx, sources, complexId);
      if (previous) return previous;
      const property = await tx.property.create({ data: {
        ...draft.data, complexId: complexId || null,
        slug: await tx.property.findUnique({ where: { slug: draft.data.slug } }) ? `${draft.data.slug}-${randomUUID().slice(0, 8)}` : draft.data.slug,
        sourceNote: [`Копия из ${draft.data.sourceName}. Проверьте цену, наличие и характеристики перед публикацией.`, ...draft.warnings].join('\n'),
        images: { create: files.map(({ name, originalName, hueShift, kind }, order) => ({ file: '/uploads/' + name, originalFile: '/uploads/' + originalName, hueShift, kind, alt: draft.data.title.slice(0, 200), order })) },
      }, select: { id: true } });
      await saveImportSources(tx, property.id, sources);
      return { id: property.id, created: true, linked: !!complexId, warnings: draft.warnings };
    });
    keepFiles = result.created;
    return result;
  } catch (error) {
    if (isError(error) && [400, 409].includes(error.statusCode) && error.data && typeof error.data === 'object' && 'message' in error.data) throw error;
    throw createError({ statusCode: 502, data: { message: 'Не удалось перенести объект или его фотографии. Новая карточка не создана. Повторите импорт.' } });
  } finally {
    if (!keepFiles) await Promise.all(writtenFiles.map(name => unlink(resolve(dir, name)).catch(() => {})));
  }
}
