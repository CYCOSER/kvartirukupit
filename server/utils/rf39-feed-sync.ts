import { randomUUID } from 'node:crypto';
import { createError, isError } from 'h3';
import { Prisma, type ImportJob, type ImportJobItem } from '@prisma/client';
import { propertySchema } from '../../shared/property';
import { mergeRf39Feed, rf39FeedBaseline } from '../../shared/rf39-feed-merge';
import { db } from './db';
import { getRf39Snapshot } from './rf39-snapshot';
import { rf39Draft, rf39Supported } from './rf39-data';
import { prepareImportImages } from './import-images';
import { lockPropertyRelations } from './property-relations';
import { ImportOwnershipLost, importInfrastructureError, type ImportConfig, type ImportExecution } from './import-execution';
import { findApartmentLayout, indexApartmentLayouts, layoutScopeWhere, mergeLayoutAvailability, prepareApartmentLayout, sameApartmentLayoutScope } from './apartment-layout';

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
type FeedDraft = ReturnType<typeof rf39Draft>;
type Prepared = { item: ImportJobItem; draft: FeedDraft; images: Awaited<ReturnType<typeof prepareImportImages>>['images']; imagesPrepared: boolean; layoutHash: string | null; warnings: string[] };
type Plan = { presentIds: number[]; authoritative: boolean; snapshotDate: string; fetchedAt: string };
const pending = ['queued', 'running'];
const batchSize = 25;
const crmSourceId = (sourceId: string | null) => {
  const match = sourceId?.match(/^rf39(?:-layout)?:([1-9]\d*)(?::[1-9]\d*)?$/);
  return match ? Number(match[1]) : null;
};
const failureMessage = (error: unknown) => {
  const data = isError(error) ? error.data as { message?: unknown } | undefined : undefined;
  return typeof data?.message === 'string' ? data.message
    : 'Не удалось обновить объект CRM. Карточка сохранена без изменений; повторите синхронизацию.';
};
const recoverable = (error: unknown) => !(error instanceof ImportOwnershipLost) &&
  (!importInfrastructureError(error) || ['P2000', 'P2002', 'P2003', 'P2004', 'P2011', 'P2025'].includes((error as { code?: string })?.code || '') ||
    /PostgresError \{ code: "(?:22003|23502|23503|23505|23514)"/.test(String((error as { message?: string })?.message || '')));

async function finishStopped(tx: Prisma.TransactionClient, jobId: string) {
  const current = await tx.importJob.findUniqueOrThrow({ where: { id: jobId }, select: { stopRequested: true } });
  if (!current.stopRequested) return false;
  await tx.importJob.update({ where: { id: jobId }, data: { status: 'stopped', token: null, leaseExpiresAt: null, activeTitle: '', finishedAt: new Date() } });
  await tx.feedSyncSetting.updateMany({ where: { id: 'rf39', lastJobId: jobId }, data: { lastError: 'Синхронизация остановлена вручную. Отсутствующие объекты не снимались с публикации.' } });
  return true;
}

async function stopped(job: ImportJob, execution: ImportExecution) {
  return db.$transaction(async tx => { await execution.guard(tx); return finishStopped(tx, job.id); });
}

async function planFeed(job: ImportJob, config: ImportConfig, execution: ImportExecution): Promise<Plan | null> {
  const item = await db.importJobItem.findUniqueOrThrow({ where: { jobId_key: { jobId: job.id, key: 'feed-plan' } } });
  if (item.status === 'completed') return item.result as unknown as Plan;
  const { feedUrl } = job.request as unknown as { feedUrl: string };
  const snapshot = await getRf39Snapshot(feedUrl, config.rf39SnapshotPath, 'refresh');
  const plan: Plan = { presentIds: snapshot.presentIds, authoritative: snapshot.authoritative, snapshotDate: snapshot.snapshotDate, fetchedAt: new Date().toISOString() };
  const work: Prisma.ImportJobItemCreateManyInput[] = [];
  const errors = [...snapshot.errors];
  for (const source of snapshot.items) {
    if (!rf39Supported(source)) continue;
    try {
      const draft = rf39Draft(source, 'apartment');
      draft.data.sourceMode = 'rf39-xml';
      draft.data.sourceFetchedAt = new Date(snapshot.snapshotDate);
      work.push({ jobId: job.id, key: `feed:${draft.data.sourceId}`, groupOrder: 0, step: work.length,
        kind: 'feed-import', source: 'rf39', title: `${draft.data.title} — CRM ${source.id}`, payload: json(draft) });
    } catch { errors.push({ id: source.id, message: 'Данные квартиры не подходят для карточки. Существующая карточка сохранена без изменений.' }); }
  }
  for (const [index, error] of errors.entries()) work.push({ jobId: job.id, key: `feed-error:${index}`, groupOrder: 0, step: work.length,
    kind: 'feed-error', source: 'rf39', title: error.id ? `Объект CRM ${error.id}` : 'Объект без ID CRM',
    payload: json({ id: error.id }), status: 'failed', error: error.message });
  return db.$transaction(async tx => {
    await execution.guard(tx);
    if (await finishStopped(tx, job.id)) return null;
    for (let offset = 0; offset < work.length; offset += 100)
      await tx.importJobItem.createMany({ data: work.slice(offset, offset + 100), skipDuplicates: true });
    await tx.importJobItem.update({ where: { id: item.id }, data: { status: 'completed', result: json(plan), error: null } });
    await tx.importJob.update({ where: { id: job.id }, data: { total: work.length, processed: errors.length, failed: errors.length, activeTitle: '' } });
    return plan;
  }, { timeout: 60000 });
}

async function existingProperties(tx: Prisma.TransactionClient, sourceIds: string[]) {
  const properties = await tx.property.findMany({ where: { sourceId: { in: sourceIds } } });
  const aliases = await tx.propertyImportSource.findMany({ where: { sourceId: { in: sourceIds } }, include: { property: true } });
  return { properties, aliases, matches(sourceId: string) {
    return [...new Map([...properties.filter(property => property.sourceId === sourceId),
      ...aliases.filter(alias => alias.sourceId === sourceId).map(alias => alias.property)].map(property => [property.id, property])).values()];
  } };
}

async function failedItem(job: ImportJob, item: ImportJobItem, error: unknown, execution: ImportExecution) {
  await db.$transaction(async tx => {
    await execution.guard(tx);
    const changed = await tx.importJobItem.updateMany({ where: { id: item.id, status: { in: pending } }, data: { status: 'failed', error: failureMessage(error) } });
    if (changed.count) await tx.importJob.update({ where: { id: job.id }, data: { processed: { increment: 1 }, failed: { increment: 1 } } });
  });
}

async function writeBatch(job: ImportJob, batch: Prepared[], execution: ImportExecution) {
  return db.$transaction(async tx => {
    await execution.guard(tx);
    if (await finishStopped(tx, job.id)) return false;
    await lockPropertyRelations(tx);
    const current = await existingProperties(tx, batch.map(row => row.draft.data.sourceId));
    const slugs = new Set((await tx.property.findMany({ where: { slug: { in: batch.map(row => row.draft.data.slug) } }, select: { slug: true } })).map(row => row.slug));
    const creates: Prisma.PropertyCreateManyInput[] = [], images: Prisma.PropertyImageCreateManyInput[] = [], aliases: Prisma.PropertyImportSourceCreateManyInput[] = [];
    const propertiesById = new Map<string, (typeof current.properties)[number]>();
    const groupedIds = new Map<string, boolean>();
    async function isGrouped(id: string) {
      if (!groupedIds.has(id)) {
        const sources = await tx.propertyImportSource.findMany({ where: { propertyId: id } });
        groupedIds.set(id, new Set(sources.map(alias => alias.apartmentKey || alias.sourceId)).size > 1);
      }
      return groupedIds.get(id)!;
    }
    const results: { item: ImportJobItem; result: { id: string; created: boolean; updated: boolean; warnings: string[] } }[] = [];
    for (const row of batch) {
      const source = row.draft.data, matches = current.matches(source.sourceId);
      if (matches.length > 1) throw createError({ statusCode: 409, data: { message: 'ID CRM связан с разными карточками. Проверьте дубликаты вручную.' } });
      let property: (typeof matches)[number] | undefined = matches[0];
      let queued: Prisma.PropertyCreateManyInput | undefined;
      const newLayoutMatch = !property && !!row.layoutHash;
      if (!property && row.layoutHash) {
        property = await findApartmentLayout(tx, source, row.layoutHash) || undefined;
        if (!property) queued = creates.find(candidate => candidate.layoutHash === row.layoutHash && sameApartmentLayoutScope(source, candidate));
      }
      if (property) {
        property = propertiesById.get(property.id) || property;
        propertiesById.set(property.id, property);
      }
      const target = property || queued;
      if (property && property.type !== 'apartment') throw createError({ statusCode: 409,
        data: { message: 'Тип существующей карточки изменён вручную. Синхронизация квартиры пропущена.' } });
      if (target && target.sourceId !== source.sourceId) {
        if (newLayoutMatch) groupedIds.set(target.id!, true);
        const grouped = !!target.layoutHash && await isGrouped(target.id!);
        const availability = grouped ? { ...mergeLayoutAvailability([
          { price: target.price, availableFloors: Array.isArray(target.availableFloors) ? target.availableFloors : [] }, source,
        ]), priceKind: 'from' } : {};
        const updated = !target.published || !target.elite || Object.entries(availability).some(([key, value]) => JSON.stringify(target[key as keyof typeof target]) !== JSON.stringify(value));
        if (queued) Object.assign(queued, { published: true, elite: true, ...availability });
        else if (updated) Object.assign(property!, await tx.property.update({ where: { id: property!.id }, data: { published: true, elite: true, ...availability } }));
        const id = target.id!;
        const existingAlias = current.aliases.find(alias => alias.sourceId === source.sourceId);
        const offer = { price: source.price, availableFloors: source.availableFloors || [] };
        if (existingAlias) await tx.propertyImportSource.update({ where: { sourceId: source.sourceId }, data: offer });
        else aliases.push({ sourceId: source.sourceId, propertyId: id, ...offer });
        results.push({ item: row.item, result: { id, created: false, updated,
          warnings: [...row.warnings, grouped
            ? 'Квартира с таким набором фотографий или планировок уже есть. Сохранена одна карточка с минимальной ценой и списком этажей.'
            : 'Объект связан с карточкой другого основного источника. Его характеристики и ручные правки сохранены.'] } });
        continue;
      }
      const id = property?.id || randomUUID();
      let updated = false;
      if (property) {
        const merge = mergeRf39Feed(property as unknown as Record<string, unknown>, source, property.rf39Baseline);
        const availability = property.layoutHash && await isGrouped(id)
          ? { ...mergeLayoutAvailability([property, source]), priceKind: 'from' } : {};
        propertySchema.parse({ ...property, ...merge.changes, ...availability, elite: true, published: true });
        updated = Object.keys(merge.changes).length > 0 || !property.published || !property.elite ||
          Object.entries(availability).some(([key, value]) => JSON.stringify(property![key as keyof typeof property]) !== JSON.stringify(value));
        Object.assign(property, await tx.property.update({ where: { id }, data: { ...merge.changes, ...availability, published: true, elite: true,
          sourceFetchedAt: source.sourceFetchedAt, rf39Baseline: json(merge.baseline) } }));
      } else {
        if (!row.imagesPrepared) throw createError({ statusCode: 409,
          data: { message: 'Карточка удалена во время синхронизации. Повторите запуск, чтобы создать её заново с фотографиями.' } });
        const slug = slugs.has(source.slug) ? `${source.slug}-${randomUUID().slice(0, 8)}` : source.slug;
        slugs.add(slug);
        creates.push({ ...source, id, slug, type: 'apartment', published: true, elite: true, sourceMode: 'rf39-xml', layoutHash: row.layoutHash,
          rf39Baseline: json(rf39FeedBaseline(source)), sourceNote: ['Синхронизация XML CRM RF39.', ...row.warnings].join('\n') });
        images.push(...row.images.map(image => ({ ...image, propertyId: id })));
      }
      const offer = { price: source.price, availableFloors: source.availableFloors || [] };
      if (current.aliases.some(alias => alias.sourceId === source.sourceId))
        await tx.propertyImportSource.update({ where: { sourceId: source.sourceId }, data: offer });
      else aliases.push({ sourceId: source.sourceId, propertyId: id, ...offer });
      results.push({ item: row.item, result: { id, created: !property, updated, warnings: row.warnings } });
    }
    if (creates.length) await tx.property.createMany({ data: creates });
    if (images.length) await tx.propertyImage.createMany({ data: images });
    if (aliases.length) await tx.propertyImportSource.createMany({ data: aliases });
    const counters = { processed: 0, created: 0, updated: 0, existing: 0 };
    for (const { item, result } of results) {
      const changed = await tx.importJobItem.updateMany({ where: { id: item.id, status: { in: pending } },
        data: { status: 'completed', result: json(result), error: null } });
      if (!changed.count) continue;
      counters.processed++;
      counters.created += Number(result.created);
      counters.updated += Number(result.updated);
      counters.existing += Number(!result.created && !result.updated);
    }
    if (counters.processed) await tx.importJob.update({ where: { id: job.id }, data: {
      processed: { increment: counters.processed }, created: { increment: counters.created },
      updated: { increment: counters.updated }, existing: { increment: counters.existing },
    } });
    return true;
  }, { timeout: 60000 });
}

async function prepareBatch(job: ImportJob, items: ImportJobItem[], execution: ImportExecution) {
  const drafts = items.map(item => {
    const stored = item.payload as unknown as FeedDraft;
    return { ...stored, data: { ...stored.data, slug: stored.data.slug.replace(/^rf39-/, 'robj-'), sourceFetchedAt: new Date(stored.data.sourceFetchedAt) } };
  });
  const current = await existingProperties(db, drafts.map(draft => draft.data.sourceId));
  const settled: (PromiseSettledResult<Prepared> | undefined)[] = new Array(items.length);
  let next = 0, abort = false;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length && !abort) {
      const index = next++, item = items[index]!, draft = drafts[index]!;
      try {
        const state = await db.importJob.findUniqueOrThrow({ where: { id: job.id }, select: { stopRequested: true } });
        if (state.stopRequested) return;
        const imagesPrepared = current.matches(draft.data.sourceId).length === 0;
        const prepared = imagesPrepared ? await prepareImportImages(draft, true) : { images: [], warnings: [], complete: true };
        const layoutHash = !prepared.complete ? '' : imagesPrepared && layoutScopeWhere(draft.data)
          ? await prepareApartmentLayout(draft.data, prepared.images) : null;
        if (layoutHash) await indexApartmentLayouts(draft.data);
        settled[index] = { status: 'fulfilled', value: { item, draft, images: prepared.images, imagesPrepared, layoutHash, warnings: [...draft.warnings, ...prepared.warnings] } };
      } catch (reason) { settled[index] = { status: 'rejected', reason }; if (!recoverable(reason)) abort = true; }
    }
  }));
  const batch: Prepared[] = [];
  for (const [index, result] of settled.entries()) {
    if (!result) continue;
    if (result.status === 'fulfilled') batch.push(result.value);
    else if (!recoverable(result.reason)) throw result.reason;
    else await failedItem(job, items[index]!, result.reason, execution);
  }
  return batch;
}

async function finish(job: ImportJob, plan: Plan, execution: ImportExecution) {
  await db.$transaction(async tx => {
    await execution.guard(tx);
    if (await finishStopped(tx, job.id)) return;
    let unpublished = 0;
    const current = await tx.importJob.findUniqueOrThrow({ where: { id: job.id }, select: { failed: true } });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('rf39-feed-schedule'))`;
    const setting = await tx.feedSyncSetting.findUnique({ where: { id: 'rf39' } });
    const sameFeed = setting?.lastJobId === job.id && setting.url === (job.request as unknown as { feedUrl: string }).feedUrl;
    if (plan.authoritative && plan.presentIds.length && !current.failed && sameFeed) {
      await lockPropertyRelations(tx);
      const present = new Set(plan.presentIds);
      const properties = await tx.property.findMany({ where: { published: true, OR: [
        { sourceId: { startsWith: 'rf39:' } }, { sourceId: { startsWith: 'rf39-layout:' } },
      ] }, select: { id: true, sourceId: true } });
      const aliases = await tx.propertyImportSource.findMany({ where: { propertyId: { in: properties.map(property => property.id) } } });
      const absent = properties.filter(property => {
        const primary = crmSourceId(property.sourceId);
        return primary !== null && !present.has(primary) && !aliases.some(alias => alias.propertyId === property.id && present.has(crmSourceId(alias.sourceId) || 0));
      }).map(property => property.id);
      for (let offset = 0; offset < absent.length; offset += 500)
        unpublished += (await tx.property.updateMany({ where: { id: { in: absent.slice(offset, offset + 500) }, published: true }, data: { published: false } })).count;
      const groups = await tx.property.findMany({ where: { type: 'apartment', layoutHash: { not: null, notIn: [''] } } });
      const offers = await tx.propertyImportSource.findMany({ where: { propertyId: { in: groups.map(property => property.id) } } });
      for (const group of groups) {
        const sources = offers.filter(offer => offer.propertyId === group.id);
        if (new Set(sources.map(offer => offer.apartmentKey || offer.sourceId)).size < 2) continue;
        const available = sources.filter(offer => {
          const id = crmSourceId(offer.sourceId);
          return id === null || present.has(id);
        });
        if (!available.length) continue;
        const availability = mergeLayoutAvailability(available);
        if (group.price !== availability.price || JSON.stringify(group.availableFloors) !== JSON.stringify(availability.availableFloors) || group.priceKind !== 'from')
          await tx.property.update({ where: { id: group.id }, data: { ...availability, priceKind: 'from' } });
      }
    }
    const message = !plan.authoritative ? 'Не у всех записей распознан ID CRM. Отсутствующие объекты не снимались с публикации.'
      : current.failed ? `Синхронизация завершена с ошибками: ${current.failed}. Отсутствующие объекты не снимались с публикации.`
      : !sameFeed ? 'Настройки выгрузки изменились. Отсутствующие объекты не снимались с публикации.' : null;
    await tx.importJob.update({ where: { id: job.id }, data: { status: 'completed', unpublished, error: message,
      token: null, leaseExpiresAt: null, activeTitle: '', finishedAt: new Date() } });
    await tx.feedSyncSetting.updateMany({ where: { id: 'rf39', lastJobId: job.id }, data: { ...(!message ? { lastSuccessAt: new Date() } : {}), lastError: message } });
  }, { timeout: 60000 });
}

export async function processRf39FeedJob(job: ImportJob, config: ImportConfig, execution: ImportExecution) {
  if (await stopped(job, execution)) return;
  const plan = await planFeed(job, config, execution);
  if (!plan) return;
  while (true) {
    const items = await db.$transaction(async tx => {
      await execution.guard(tx);
      if (await finishStopped(tx, job.id)) return null;
      const rows = await tx.importJobItem.findMany({ where: { jobId: job.id, kind: 'feed-import', status: { in: pending } }, orderBy: { step: 'asc' }, take: batchSize });
      if (rows.length) {
        await tx.importJobItem.updateMany({ where: { id: { in: rows.map(row => row.id) } }, data: { status: 'running', error: null } });
        await tx.importJob.update({ where: { id: job.id }, data: { activeTitle: rows[0]!.title } });
      }
      return rows;
    });
    if (!items) return;
    if (!items.length) break;
    const batch = await prepareBatch(job, items, execution);
    if (await stopped(job, execution)) return;
    try { if (!await writeBatch(job, batch, execution)) return; }
    catch (error) {
      if (!recoverable(error)) throw error;
      for (const row of batch) {
        if (await stopped(job, execution)) return;
        try { if (!await writeBatch(job, [row], execution)) return; }
        catch (cause) { if (!recoverable(cause)) throw cause; await failedItem(job, row.item, cause, execution); }
      }
    }
  }
  await finish(job, plan, execution);
}
