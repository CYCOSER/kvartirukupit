import { randomUUID } from 'node:crypto';
import { createError, isError } from 'h3';
import { Prisma, type ImportJob, type ImportJobItem } from '@prisma/client';
import { propertySchema } from '../../shared/property';
import { mergeRf39Feed, rf39FeedBaseline } from '../../shared/rf39-feed-merge';
import { db } from './db';
import { getRf39Snapshot } from './rf39-snapshot';
import { rf39CatalogDraft, rf39CatalogItems, rf39Draft, rf39Supported } from './rf39-data';
import { prepareImportImages } from './import-images';
import { lockPropertyRelations } from './property-relations';
import { ImportOwnershipLost, importInfrastructureError, type ImportConfig, type ImportExecution } from './import-execution';
import { findApartmentLayout, indexApartmentLayouts, layoutScopeWhere, mergeLayoutAvailability, prepareApartmentLayout, sameApartmentLayout } from './apartment-layout';
import { missingApartmentFloorPlans } from './apartment-layout-gallery';

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
type FeedDraft = ReturnType<typeof rf39Draft> & { complexSourceId?: string; aliasSourceIds?: string[]; unitPlanImageUrls?: string[]; floorPlanImageUrls?: string[] };
type Prepared = { item: ImportJobItem; draft: FeedDraft; images: Awaited<ReturnType<typeof prepareImportImages>>['images']; imagesPrepared: boolean; layoutHash: string | null; warnings: string[] };
type Plan = { presentIds: number[]; presentSourceIds?: string[]; authoritative: boolean; snapshotDate: string; fetchedAt: string };
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
  const catalog = rf39CatalogItems(snapshot.items);
  const plan: Plan = { presentIds: snapshot.presentIds, presentSourceIds: catalog.filter(entry => rf39Supported(entry.item)).map(entry => entry.sourceId),
    authoritative: snapshot.authoritative, snapshotDate: snapshot.snapshotDate, fetchedAt: new Date().toISOString() };
  const work: Prisma.ImportJobItemCreateManyInput[] = [];
  const errors = [...snapshot.errors];
  for (const entry of catalog) {
    if (!rf39Supported(entry.item)) continue;
    try {
      const draft = rf39CatalogDraft(entry);
      draft.data.sourceMode = 'rf39-xml';
      draft.data.sourceFetchedAt = new Date(snapshot.snapshotDate);
      const feedDraft: FeedDraft = { ...draft,
        ...(entry.complexSourceId ? { complexSourceId: entry.complexSourceId } : {}),
        ...(entry.legacySourceId ? { aliasSourceIds: [entry.legacySourceId] } : {}) };
      work.push({ jobId: job.id, key: `feed:${draft.data.sourceId}`, groupOrder: 0, step: work.length,
        kind: 'feed-import', source: 'rf39', title: `${draft.data.title} — CRM ${entry.objectId}`, payload: json(feedDraft) });
    } catch { errors.push({ id: entry.objectId, message: `Данные ${entry.type === 'complex' ? 'ЖК' : 'квартиры'} не подходят для карточки. Существующая карточка сохранена без изменений.` }); }
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
    const current = await existingProperties(tx, batch.flatMap(row =>
      [row.draft.data.sourceId, row.draft.complexSourceId, ...(row.draft.aliasSourceIds || [])]
        .filter((sourceId): sourceId is string => !!sourceId)));
    const slugs = new Set((await tx.property.findMany({ where: { slug: { in: batch.map(row => row.draft.data.slug) } }, select: { slug: true } })).map(row => row.slug));
    const creates: Prisma.PropertyCreateManyInput[] = [], images: Prisma.PropertyImageCreateManyInput[] = [], aliases: Prisma.PropertyImportSourceCreateManyInput[] = [];
    const propertiesById = new Map<string, (typeof current.properties)[number]>();
    const groupedIds = new Map<string, boolean>();
    const complexIds = new Map<string, string>();
    const queuedAliases = new Map<string, string>();
    function addAlias(sourceId: string, propertyId: string, type: string, offer: { price: number | null; availableFloors: number[] }) {
      const matches = current.matches(sourceId);
      if (matches.length && matches.every(property => property.type !== type)) return;
      if (matches.some(property => property.id !== propertyId)) throw createError({ statusCode: 409,
        data: { message: 'ID CRM связан с другой карточкой; дополнительная связь ЖК не сохранена.' } });
      const queued = queuedAliases.get(sourceId);
      if (matches.length) return;
      if (queued && queued !== propertyId) throw createError({ statusCode: 409,
        data: { message: 'ID CRM связан с несколькими карточками; дополнительная связь ЖК не сохранена.' } });
      if (queued) return;
      queuedAliases.set(sourceId, propertyId);
      aliases.push({ sourceId, propertyId, ...offer });
    }
    function findComplexId(sourceId: string) {
      const staged = complexIds.get(sourceId);
      if (staged) return staged;
      const matches = current.matches(sourceId).filter(property => property.type === 'complex');
      if (matches.length !== 1) throw createError({ statusCode: 409,
        data: { message: 'Не удалось однозначно найти карточку ЖК для связи с квартирой. ЖК сохранён, квартиру можно повторить после проверки.' } });
      return matches[0]!.id;
    }
    async function isGrouped(id: string) {
      if (!groupedIds.has(id)) {
        const sources = await tx.propertyImportSource.findMany({ where: { propertyId: id } });
        groupedIds.set(id, new Set(sources.map(alias => alias.apartmentKey || alias.sourceId)).size > 1);
      }
      return groupedIds.get(id)!;
    }
    const results: { item: ImportJobItem; result: { id: string; created: boolean; updated: boolean; warnings: string[] } }[] = [];
    for (const row of batch) {
      const source = row.draft.data;
      const matches = [...new Map([...current.matches(source.sourceId),
        ...(row.draft.aliasSourceIds || []).flatMap(sourceId => current.matches(sourceId)).filter(property => property.type === source.type)]
        .map(property => [property.id, property])).values()];
      const isApartment = source.type === 'apartment';
      const requestedComplexId = isApartment && row.draft.complexSourceId ? findComplexId(row.draft.complexSourceId) : undefined;
      if (matches.length > 1) throw createError({ statusCode: 409, data: { message: 'ID CRM связан с разными карточками. Проверьте дубликаты вручную.' } });
      let property: (typeof matches)[number] | undefined = matches[0];
      let queued: Prisma.PropertyCreateManyInput | undefined;
      const newLayoutMatch = !property && !!row.layoutHash;
      if (!property && row.layoutHash) {
        property = await findApartmentLayout(tx, source, row.layoutHash, undefined, row.images) || undefined;
        if (!property) for (const candidate of creates) {
          if (await sameApartmentLayout(source, row.images, candidate, images.filter(image => image.propertyId === candidate.id), tx)) {
            queued = candidate;
            break;
          }
        }
      }
      if (property) {
        property = propertiesById.get(property.id) || property;
        propertiesById.set(property.id, property);
      }
      const target = property || queued;
      if (property && property.type !== source.type) throw createError({ statusCode: 409,
        data: { message: `Тип существующей карточки изменён вручную. Синхронизация ${isApartment ? 'квартиры' : 'ЖК'} пропущена.` } });
      if (!isApartment && property) complexIds.set(source.sourceId, property.id);
      let addedFloors = 0;
      let galleryWarnings: string[] = [];
      if (target && row.images.some(image => image.planRole === 'floor')) {
        const gallery = queued ? images.filter(image => image.propertyId === target.id)
          : [...await tx.propertyImage.findMany({ where: { propertyId: target.id } }), ...images.filter(image => image.propertyId === target.id)];
        const floors = await missingApartmentFloorPlans(gallery.map(image => ({ ...image, order: image.order || 0 })), row.images, tx);
        images.push(...floors.images.map(image => ({ ...image, propertyId: target.id! })));
        addedFloors = floors.images.length;
        galleryWarnings = floors.warnings;
      }
      if (target && target.sourceId !== source.sourceId) {
        if (newLayoutMatch) groupedIds.set(target.id!, true);
        const grouped = !!target.layoutHash && await isGrouped(target.id!);
        const sameCrmSource = !isApartment && !!property && ['rf39-copy', 'rf39-xml'].includes(property.sourceMode || '');
        const availability = isApartment && grouped ? { ...mergeLayoutAvailability([
          { price: target.price, availableFloors: Array.isArray(target.availableFloors) ? target.availableFloors : [] }, source,
        ]), priceKind: 'from' } : {};
        const linkComplex = isApartment && requestedComplexId && !target.complexId ? { complexId: requestedComplexId } : {};
        const publish = isApartment ? { published: true, elite: true } : {};
        let updated = addedFloors > 0 || isApartment && (!target.published || !target.elite) ||
          Object.entries({ ...availability, ...linkComplex }).some(([key, value]) => JSON.stringify(target[key as keyof typeof target]) !== JSON.stringify(value));
        if (queued) Object.assign(queued, publish, availability, linkComplex);
        else if (updated) Object.assign(property!, await tx.property.update({ where: { id: property!.id }, data: { ...publish, ...availability, ...linkComplex } }));
        else if (sameCrmSource && property) {
          const merge = mergeRf39Feed(property as unknown as Record<string, unknown>, source, property.rf39Baseline);
          propertySchema.parse({ ...property, ...merge.changes });
          updated = Object.keys(merge.changes).length > 0;
          Object.assign(property, await tx.property.update({ where: { id: property.id },
            data: { ...merge.changes, sourceFetchedAt: source.sourceFetchedAt, rf39Baseline: json(merge.baseline) } }));
        }
        const id = target.id!;
        if (!isApartment) complexIds.set(source.sourceId, id);
        const existingAlias = current.aliases.find(alias => alias.sourceId === source.sourceId);
        const offer = { price: source.price, availableFloors: source.availableFloors || [] };
        if (existingAlias) await tx.propertyImportSource.update({ where: { sourceId: source.sourceId }, data: offer });
        else aliases.push({ sourceId: source.sourceId, propertyId: id, ...offer });
        results.push({ item: row.item, result: { id, created: false, updated,
          warnings: [...row.warnings, ...galleryWarnings, requestedComplexId && target.complexId && target.complexId !== requestedComplexId
            ? 'Сохранена существующая ручная связь квартиры с другим ЖК.' : '', grouped
            ? 'Квартира с таким набором фотографий или планировок уже есть. Сохранена одна карточка с минимальной ценой и списком этажей.'
            : isApartment ? 'Объект связан с карточкой другого основного источника. Его характеристики и ручные правки сохранены.'
              : sameCrmSource ? '' : 'ЖК связан с карточкой другого основного источника; его ручные данные сохранены.'].filter(Boolean) } });
        continue;
      }
      const id = property?.id || randomUUID();
      let updated = false;
      if (property) {
        const merge = mergeRf39Feed(property as unknown as Record<string, unknown>, source, property.rf39Baseline);
        const availability = isApartment && property.layoutHash && await isGrouped(id)
          ? { ...mergeLayoutAvailability([property, source]), priceKind: 'from' } : {};
        const linkComplex = isApartment && requestedComplexId && !property.complexId ? { complexId: requestedComplexId } : {};
        const publish = isApartment ? { published: true, elite: true } : {};
        propertySchema.parse({ ...property, ...merge.changes, ...availability, ...linkComplex, ...publish });
        updated = addedFloors > 0 || Object.keys(merge.changes).length > 0 || isApartment && (!property.published || !property.elite) ||
          Object.entries({ ...availability, ...linkComplex }).some(([key, value]) => JSON.stringify(property![key as keyof typeof property]) !== JSON.stringify(value));
        Object.assign(property, await tx.property.update({ where: { id }, data: { ...merge.changes, ...availability, ...linkComplex, ...publish,
          sourceFetchedAt: source.sourceFetchedAt, rf39Baseline: json(merge.baseline) } }));
      } else {
        if (!row.imagesPrepared) throw createError({ statusCode: 409,
          data: { message: 'Карточка удалена во время синхронизации. Повторите запуск, чтобы создать её заново с фотографиями.' } });
        const slug = slugs.has(source.slug) ? `${source.slug}-${randomUUID().slice(0, 8)}` : source.slug;
        slugs.add(slug);
        creates.push({ ...source, id, slug, ...(isApartment ? { type: 'apartment', published: true, elite: true, complexId: requestedComplexId || null }
          : { type: 'complex', published: false, elite: false, complexId: null }), sourceMode: 'rf39-xml', layoutHash: row.layoutHash,
          rf39Baseline: json(rf39FeedBaseline(source)), sourceNote: ['Синхронизация XML CRM RF39.', ...row.warnings].join('\n') });
        images.push(...row.images.map(image => ({ ...image, propertyId: id })));
      }
      if (!isApartment) complexIds.set(source.sourceId, id);
      if (isApartment && property?.complexId && requestedComplexId && property.complexId !== requestedComplexId)
        row.warnings.push('Сохранена существующая ручная связь квартиры с другим ЖК.');
      const offer = { price: source.price, availableFloors: source.availableFloors || [] };
      if (current.aliases.some(alias => alias.sourceId === source.sourceId))
        await tx.propertyImportSource.update({ where: { sourceId: source.sourceId }, data: offer });
      else aliases.push({ sourceId: source.sourceId, propertyId: id, ...offer });
      for (const aliasSourceId of row.draft.aliasSourceIds || []) addAlias(aliasSourceId, id, source.type, offer);
      results.push({ item: row.item, result: { id, created: !property, updated, warnings: [...row.warnings, ...galleryWarnings] } });
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
  const current = await existingProperties(db, drafts.flatMap(draft =>
    [draft.data.sourceId, draft.complexSourceId, ...(draft.aliasSourceIds || [])].filter((sourceId): sourceId is string => !!sourceId)));
  const settled: (PromiseSettledResult<Prepared> | undefined)[] = new Array(items.length);
  let next = 0, abort = false;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length && !abort) {
      const index = next++, item = items[index]!, draft = drafts[index]!;
      try {
        const state = await db.importJob.findUniqueOrThrow({ where: { id: job.id }, select: { stopRequested: true } });
        if (state.stopRequested) return;
        const hasExisting = [draft.data.sourceId, ...(draft.aliasSourceIds || [])].some(sourceId =>
          current.matches(sourceId).some(property => property.type === draft.data.type));
        const imagesPrepared = !hasExisting || !!draft.floorPlanImageUrls?.length;
        const prepared = imagesPrepared ? await prepareImportImages(draft, draft.data.type === 'apartment') : { images: [], warnings: [], complete: true };
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
      const presentSources = new Set(plan.presentSourceIds || []);
      const isPresent = (sourceId: string | null) => {
        if (!sourceId) return false;
        if (presentSources.has(sourceId)) return true;
        const id = crmSourceId(sourceId);
        return id !== null && present.has(id);
      };
      const properties = await tx.property.findMany({ where: { published: true, OR: [
        { sourceId: { startsWith: 'rf39:' } }, { sourceId: { startsWith: 'rf39-layout:' } },
      ] }, select: { id: true, sourceId: true } });
      const aliases = await tx.propertyImportSource.findMany({ where: { propertyId: { in: properties.map(property => property.id) } } });
      const absent = properties.filter(property => {
        return !isPresent(property.sourceId) && !aliases.some(alias => alias.propertyId === property.id && isPresent(alias.sourceId));
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
