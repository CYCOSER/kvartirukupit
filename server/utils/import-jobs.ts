import { randomUUID } from 'node:crypto';
import { createError, isError } from 'h3';
import { Prisma, type ImportJob, type ImportJobItem } from '@prisma/client';
import { db } from './db';
import { findComplexApartments } from './find-complex-apartments';
import { importRf39Property } from './import-rf39';
import { existingImportedProperty } from './import-property';
import { importNmarketProperty } from './import-nmarket';
import { ImportOwnershipLost, importInfrastructureError, type ImportConfig, type ImportExecution } from './import-execution';
import type { ImportJobRequest, ImportJobView, ImportJobItemView, ImportSource } from '../../shared/import-job';

type Candidate = { id: string | number; layoutId?: number; preferredNmarketId?: string; matchedNmarketIds?: string[] };
type SearchResult = Awaited<ReturnType<typeof findComplexApartments>>;
type ItemData = Pick<ImportJobItem, 'key' | 'groupOrder' | 'step' | 'kind' | 'source' | 'title' | 'complexId' | 'complexTitle'> & {
  payload: Prisma.InputJsonValue; status?: string; result?: Prisma.InputJsonValue;
};
const active = ['queued', 'running'];
const leaseMs = 120000;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const itemOrder = [{ groupOrder: 'asc' }, { step: 'asc' }, { key: 'asc' }] as const;

function summary(job: ImportJob): ImportJobView {
  const request = job.request as unknown as ImportJobRequest;
  return {
    id: job.id, kind: request.kind, status: job.status as ImportJobView['status'],
    title: request.kind === 'import' ? `Импорт из ${request.source === 'rf39' ? 'CRM RF39' : 'Нмаркета'}` : `Квартиры для ЖК: ${request.complexIds.length}`,
    ...(request.kind === 'import' ? { source: request.source } : { complexIds: request.complexIds, preferredSource: request.preferredSource }),
    ...(request.snapshot ? { snapshot: request.snapshot } : {}),
    createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(), finishedAt: job.finishedAt?.toISOString() || null,
    stopRequested: job.stopRequested, total: job.total, processed: job.processed, created: job.created,
    linked: job.linked, existing: job.existing, failed: job.failed, activeTitle: job.activeTitle, error: job.error,
    canRetry: !active.includes(job.status) && (job.failed > 0 || job.processed < job.total),
  };
}
function itemView(item: ImportJobItem): ImportJobItemView {
  const payload = item.payload as unknown as Candidate;
  const result = (item.result || {}) as Record<string, unknown>;
  return {
    id: item.id, kind: item.kind as ImportJobItemView['kind'], title: item.title,
    source: item.source as ImportJobItemView['source'], status: item.status as ImportJobItemView['status'],
    ...(item.complexId ? { complexId: item.complexId, complexTitle: item.complexTitle || item.complexId } : {}),
    ...(payload.id !== undefined ? { sourceId: payload.id } : {}), ...(payload.layoutId ? { layoutId: payload.layoutId } : {}),
    ...(typeof result.id === 'string' ? { propertyId: result.id } : {}),
    created: result.created === true, linked: result.linked === true || Number(result.linked) > 0,
    ...(item.error ? { error: item.error } : {}), warnings: Array.isArray(result.warnings) ? result.warnings as string[] : [],
  };
}
export async function listImportJobs(ownerId: string) {
  const [running, recent] = await Promise.all([
    db.importJob.findMany({ where: { ownerId, status: { in: active } }, orderBy: { createdAt: 'desc' } }),
    db.importJob.findMany({ where: { ownerId, status: { notIn: active } }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);
  return [...running, ...recent].map(summary);
}
export async function getImportJob(ownerId: string, id: string, details = true) {
  const job = await db.importJob.findFirst({ where: { id, ownerId } });
  if (!job) throw createError({ statusCode: 404, data: { message: 'Задание не найдено.' } });
  const view = summary(job);
  if (details) view.items = (await db.importJobItem.findMany({ where: { jobId: id, kind: { not: 'plan' } }, orderBy: [...itemOrder] })).map(itemView);
  return view;
}
export async function deleteImportJob(ownerId: string, id: string) {
  const deleted = await db.importJob.deleteMany({ where: { id, ownerId, status: { in: ['completed', 'stopped', 'failed'] }, token: null } });
  if (deleted.count) return { ok: true };
  const job = await db.importJob.findFirst({ where: { id, ownerId }, select: { id: true } });
  if (!job) throw createError({ statusCode: 404, data: { message: 'Задание не найдено.' } });
  throw createError({ statusCode: 409, data: { message: 'Сначала остановите задание и дождитесь завершения текущей операции.' } });
}
async function saveJob(ownerId: string, request: ImportJobRequest, items: ItemData[]) {
  const previous = await db.importJob.findUnique({ where: { ownerId_requestId: { ownerId, requestId: request.requestId } } });
  if (previous) return summary(previous);
  try {
    const job = await db.$transaction(async tx => {
      const job = await tx.importJob.create({ data: {
        ownerId, requestId: request.requestId, kind: request.kind, request: json(request.kind === 'import' ? { ...request, items: [] } : request),
        total: items.filter(item => item.kind !== 'plan' && item.status !== 'skipped').length,
      } });
      for (let offset = 0; offset < items.length; offset += 1000)
        await tx.importJobItem.createMany({ data: items.slice(offset, offset + 1000).map(item => ({ ...item, jobId: job.id })) });
      return job;
    }, { timeout: 60000 });
    return summary(job);
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      const existing = await db.importJob.findUnique({ where: { ownerId_requestId: { ownerId, requestId: request.requestId } } });
      if (existing) return summary(existing);
    }
    throw error;
  }
}
export async function createImportJob(ownerId: string, request: ImportJobRequest) {
  if (request.kind === 'import') {
    const chosen = [...new Map(request.items.map(item => [String(item.id), item])).values()];
    return saveJob(ownerId, { ...request, items: chosen }, chosen.map((item, step) => ({
      key: `import:${item.id}`, groupOrder: 0, step, kind: 'import', source: request.source,
      title: item.title || `Объект ${item.id}`, complexId: null, complexTitle: null, payload: json({ id: item.id }),
    })));
  }
  const ids = [...new Set(request.complexIds)];
  const complexes = await db.property.findMany({ where: { id: { in: ids }, type: 'complex' }, select: { id: true, title: true } });
  const titles = new Map(complexes.map(item => [item.id, item.title]));
  const items: ItemData[] = ids.flatMap((id, groupOrder) => {
    const title = titles.get(id) || id;
    const common = { groupOrder, complexId: id, complexTitle: title, payload: {} };
    return [
      ...(['local', 'nmarket', 'rf39'] as const).map((source, index) => ({
        ...common, key: `${id}:search:${source}`, step: index - 3, kind: 'search', source, title: `${title} — ${source === 'local' ? 'база сайта' : source === 'rf39' ? 'CRM RF39' : 'Нмаркет'}`,
      })),
      { ...common, key: `${id}:plan`, step: 0, kind: 'plan', source: 'local', title },
      { ...common, key: `${id}:rescan`, step: 1000001, kind: 'rescan', source: 'local', title: `${title} — итоговая привязка` },
    ];
  });
  return saveJob(ownerId, { ...request, complexIds: ids }, items);
}
export async function stopImportJob(ownerId: string, id: string) {
  await getImportJob(ownerId, id, false);
  await db.importJob.updateMany({ where: { id, ownerId, status: 'queued', token: null }, data: { status: 'stopped', stopRequested: true, activeTitle: '', finishedAt: new Date() } });
  await db.importJob.updateMany({ where: { id, ownerId, status: { in: active } }, data: { stopRequested: true } });
  return getImportJob(ownerId, id, false);
}
export async function retryImportJob(ownerId: string, id: string, requestId: string) {
  const view = await getImportJob(ownerId, id, false);
  if (!view.canRetry) throw createError({ statusCode: 409, data: { message: 'Нет ошибок или необработанных объектов для повтора.' } });
  const job = await db.importJob.findUniqueOrThrow({ where: { id } });
  const request = job.request as unknown as ImportJobRequest;
  const items = await db.importJobItem.findMany({ where: { jobId: id }, orderBy: [...itemOrder] });
  if (request.kind === 'import') {
    return createImportJob(ownerId, { ...request, requestId, items: items.filter(item => !['completed', 'skipped'].includes(item.status)).map(item => ({ id: (item.payload as unknown as Candidate).id, title: item.title })) });
  }
  const groups = new Set(items.filter(item => item.kind !== 'plan' && !['completed', 'skipped'].includes(item.status)).map(item => item.groupOrder));
  const selected = items.filter(item => groups.has(item.groupOrder));
  return saveJob(ownerId, { ...request, requestId, complexIds: request.complexIds.filter(id => selected.some(item => item.complexId === id)) }, selected.map(item => ({
    key: item.key, groupOrder: item.groupOrder, step: item.step, kind: item.kind, source: item.source,
    title: item.title, complexId: item.complexId, complexTitle: item.complexTitle, payload: json(item.payload),
    status: item.kind === 'plan' || !['completed', 'skipped'].includes(item.status) ? 'queued' : 'skipped',
    ...(item.result ? { result: json(item.result) } : {}),
  })));
}

async function planImports(job: ImportJob, item: ImportJobItem, execution: ImportExecution) {
  const request = job.request as unknown as Extract<ImportJobRequest, { kind: 'apartments' }>;
  const searches = await db.importJobItem.findMany({ where: { jobId: job.id, groupOrder: item.groupOrder, kind: 'search' } });
  const results = new Map(searches.filter(search => search.result && ['completed', 'skipped'].includes(search.status)).map(search => [search.source, search.result as unknown as SearchResult]));
  const crmMatches = new Map((results.get('rf39')?.candidates || []).flatMap(candidate =>
    (candidate.matchedNmarketIds || (candidate.preferredNmarketId ? [candidate.preferredNmarketId] : [])).map(id => [id, candidate] as const)));
  const order: ImportSource[] = request.preferredSource === 'rf39' ? ['rf39', 'nmarket'] : ['nmarket', 'rf39'];
  const planned: ItemData[] = [];
  for (const source of order) {
    for (const candidate of results.get(source)?.candidates || []) {
      const crm = source === 'nmarket' && request.preferredSource === 'rf39' ? crmMatches.get(String(candidate.id)) : undefined;
      const actual = crm || candidate;
      planned.push({
        key: `${item.complexId}:import:${source}:${candidate.id}:${candidate.layoutId || ''}`,
        groupOrder: item.groupOrder, step: planned.length + 1, kind: 'import', source: crm ? 'rf39' : source,
        title: `${item.complexTitle} — ${candidate.id}${candidate.layoutId ? `, квартира ${candidate.layoutId}` : ''}`,
        complexId: item.complexId, complexTitle: item.complexTitle,
        payload: json({ id: actual.id, ...(actual.layoutId ? { layoutId: actual.layoutId } : {}), ...(actual.preferredNmarketId ? { preferredNmarketId: actual.preferredNmarketId } : {}) }),
      });
    }
  }
  await db.$transaction(async tx => {
    await execution.guard(tx);
    let count = 0;
    for (let offset = 0; offset < planned.length; offset += 1000)
      count += (await tx.importJobItem.createMany({ data: planned.slice(offset, offset + 1000).map(row => ({ ...row, jobId: job.id })), skipDuplicates: true })).count;
    await tx.importJob.update({ where: { id: job.id }, data: { total: { increment: count } } });
    await execution.complete?.(tx, {});
  }, { timeout: 60000 });
}

export async function processNextImportJob(config: ImportConfig) {
  const now = new Date();
  const available = { status: { in: active }, OR: [{ token: null }, { leaseExpiresAt: { lte: now } }] };
  const next = await db.importJob.findFirst({ where: available, orderBy: { createdAt: 'asc' } });
  if (!next) return false;
  const token = randomUUID();
  const claimed = await db.importJob.updateMany({ where: { id: next.id, ...available }, data: { status: 'running', token, leaseExpiresAt: new Date(Date.now() + leaseMs), error: null } });
  if (!claimed.count) return false;
  const owned = { id: next.id, status: 'running', token };
  let heartbeatError: unknown;
  let heartbeatPending: Promise<void> | undefined;
  const heartbeat = setInterval(() => {
    if (heartbeatPending) return;
    heartbeatPending = db.importJob.updateMany({ where: { ...owned, leaseExpiresAt: { gt: new Date() } }, data: { leaseExpiresAt: new Date(Date.now() + leaseMs) } })
      .then(result => { if (!result.count) throw new ImportOwnershipLost(); })
      .catch(error => { heartbeatError = error; })
      .finally(() => { heartbeatPending = undefined; });
  }, 30000);
  const guard = async (tx: Prisma.TransactionClient) => {
    if (heartbeatError) throw heartbeatError;
    // This row lock fences every property mutation and its durable result from an expired worker.
    const result = await tx.importJob.updateMany({ where: { ...owned, leaseExpiresAt: { gt: new Date() } }, data: { updatedAt: new Date() } });
    if (!result.count) throw new ImportOwnershipLost();
  };
  try {
    const work = await db.$transaction(async tx => {
      await guard(tx);
      const current = await tx.importJob.findUniqueOrThrow({ where: { id: next.id }, select: { stopRequested: true } });
      if (current.stopRequested) {
        await tx.importJob.update({ where: { id: next.id }, data: { status: 'stopped', token: null, leaseExpiresAt: null, activeTitle: '', finishedAt: new Date() } });
        return null;
      }
      const job = next;
      const item = await tx.importJobItem.findFirst({ where: { jobId: job.id, status: { in: ['queued', 'running'] } }, orderBy: [...itemOrder] });
      if (!item) {
        await tx.importJob.update({ where: { id: job.id }, data: { status: 'completed', token: null, leaseExpiresAt: null, activeTitle: '', finishedAt: new Date() } });
        return null;
      }
      await tx.importJobItem.update({ where: { id: item.id }, data: { status: 'running', error: null } });
      await tx.importJob.update({ where: { id: job.id }, data: { activeTitle: item.title } });
      return { job, item };
    });
    if (!work) return true;
    const { job, item } = work;
    const request = job.request as unknown as ImportJobRequest;
    const complete: ImportExecution['complete'] = async (tx, value) => {
      const result = value as Record<string, unknown>;
      const changed = await tx.importJobItem.updateMany({ where: { id: item.id, status: 'running' }, data: { status: 'completed', result: json(value), error: null } });
      if (!changed.count) return;
      const imported = item.kind === 'import';
      await tx.importJob.update({ where: { id: job.id }, data: {
        processed: { increment: item.kind === 'plan' ? 0 : 1 },
        created: { increment: imported && result.created ? 1 : 0 },
        linked: { increment: imported ? (!result.created && result.linked ? 1 : 0) : Number(result.linked) || 0 },
        existing: { increment: imported ? (!result.created && !result.linked ? 1 : 0) : item.kind === 'rescan' ? 0 : Number(result.existing) || 0 },
      } });
    };
    const execution: ImportExecution = { guard, complete };
    try {
      if (item.kind === 'plan') await planImports(job, item, execution);
      else if (item.kind === 'search' || item.kind === 'rescan') {
        const result = await findComplexApartments(config, item.complexId!, { source: item.source as 'local' | ImportSource, snapshot: request.snapshot }, execution);
        await db.$transaction(async tx => { await guard(tx); await complete(tx, result); });
      } else {
        const input = item.payload as unknown as Candidate;
        const complexId = item.complexId || undefined;
        if (item.source === 'rf39') {
          let persistedMatch;
          if (complexId) {
            const search = await db.importJobItem.findUnique({ where: { jobId_key: { jobId: job.id, key: `${complexId}:search:rf39` } } });
            const sourceId = input.layoutId ? `rf39-layout:${input.id}:${input.layoutId}` : `rf39:${input.id}`;
            const match = (search?.result as unknown as SearchResult | undefined)?.apartmentMatches?.find(([id]) => id === sourceId)?.[1];
            if (match) persistedMatch = { ...match, expires: Infinity };
          }
          await importRf39Property(config, { id: Number(input.id), layoutId: input.layoutId, preferredNmarketId: input.preferredNmarketId,
            complexId, snapshot: request.snapshot, preferredSource: request.kind === 'apartments' ? request.preferredSource : 'nmarket' }, execution, persistedMatch || null);
        } else {
          const existing = await existingImportedProperty(`nmarket:${input.id}`, complexId, [], execution);
          if (!existing) await importNmarketProperty(config, String(input.id), complexId, request.snapshot === 'saved', undefined, execution);
        }
      }
    } catch (error) {
      if (importInfrastructureError(error) || !isError(error)) throw error;
      const data = error.data as { message?: unknown } | undefined;
      const message = typeof data?.message === 'string' ? data.message : 'Источник временно недоступен. Повторите обработку объекта.';
      await db.$transaction(async tx => {
        await guard(tx);
        const changed = await tx.importJobItem.updateMany({ where: { id: item.id, status: 'running' }, data: { status: 'failed', error: message } });
        if (changed.count) await tx.importJob.update({ where: { id: job.id }, data: { processed: { increment: item.kind === 'plan' ? 0 : 1 }, failed: { increment: 1 } } });
      });
    }
    await db.$transaction(async tx => {
      await guard(tx);
      const current = await tx.importJob.findUniqueOrThrow({ where: { id: job.id }, select: { stopRequested: true } });
      const pending = await tx.importJobItem.count({ where: { jobId: job.id, status: { in: ['queued', 'running'] } } });
      const status = current.stopRequested ? 'stopped' : pending ? 'queued' : 'completed';
      await tx.importJob.update({ where: { id: job.id }, data: { status, token: null, leaseExpiresAt: null, activeTitle: '', finishedAt: status === 'queued' ? null : new Date() } });
    });
    return true;
  } catch (error) {
    if (importInfrastructureError(error)) throw error;
    await db.$transaction(async tx => {
      await guard(tx);
      await tx.importJob.update({ where: { id: next.id }, data: { status: 'failed', token: null, leaseExpiresAt: null, activeTitle: '', finishedAt: new Date(), error: 'Обработка остановлена из-за ошибки сервера. Необработанные объекты сохранены для повтора.' } });
    });
    return true;
  } finally {
    clearInterval(heartbeat);
    await heartbeatPending;
  }
}
