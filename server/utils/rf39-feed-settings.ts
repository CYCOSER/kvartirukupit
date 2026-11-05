import { randomUUID } from 'node:crypto';
import { createError } from 'h3';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { getImportJob } from './import-jobs';
import { DEFAULT_RF39_FEED_URL, feedSyncInputSchema, type FeedSyncInput, type FeedSyncSettings } from '../../shared/feed-sync';

const active = ['queued', 'running'];
const defaultUrl = () => feedSyncInputSchema.shape.url.parse(process.env.NUXT_RF39_FEED_URL || DEFAULT_RF39_FEED_URL);
async function lock(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('rf39-feed-schedule'))`;
}

export async function getRf39FeedUrl(fallback = defaultUrl()) {
  return (await db.feedSyncSetting.findUnique({ where: { id: 'rf39' }, select: { url: true } }))?.url || fallback;
}
export async function getRf39FeedSettings(ownerId?: string): Promise<FeedSyncSettings> {
  const [settings, running] = await Promise.all([
    db.feedSyncSetting.findUnique({ where: { id: 'rf39' } }),
    db.importJob.findFirst({ where: { kind: 'sync', status: { in: active } }, orderBy: { createdAt: 'desc' }, select: { id: true, ownerId: true } }),
  ]);
  const previous = settings?.lastJobId ? await db.importJob.findFirst({ where: { id: settings.lastJobId, ...(ownerId ? { ownerId } : {}) }, select: { id: true } }) : null;
  return {
    url: settings?.url || defaultUrl(), enabled: settings?.enabled || false, intervalMinutes: settings?.intervalMinutes || 60,
    nextRunAt: settings?.nextRunAt?.toISOString() || null, lastSuccessAt: settings?.lastSuccessAt?.toISOString() || null,
    lastError: settings?.lastError || null, lastJobId: previous?.id || null,
    activeJobId: running && (!ownerId || running.ownerId === ownerId) ? running.id : null,
  };
}
export async function saveRf39FeedSettings(ownerId: string, input: FeedSyncInput) {
  const data = feedSyncInputSchema.parse(input);
  await db.$transaction(async tx => {
    await lock(tx);
    const previous = await tx.feedSyncSetting.findUnique({ where: { id: 'rf39' } });
    const nextRunAt = data.enabled
      ? previous?.enabled && previous.url === data.url && previous.intervalMinutes === data.intervalMinutes
        ? previous.nextRunAt || new Date(Date.now() + data.intervalMinutes * 60000)
        : new Date(Date.now() + data.intervalMinutes * 60000)
      : null;
    await tx.feedSyncSetting.upsert({ where: { id: 'rf39' },
      create: { id: 'rf39', ownerId, ...data, nextRunAt }, update: { ownerId, ...data, nextRunAt } });
  });
  return getRf39FeedSettings(ownerId);
}

async function enqueue(tx: Prisma.TransactionClient, ownerId: string, requestId: string, feedUrl: string) {
  const job = await tx.importJob.create({ data: {
    ownerId, requestId, kind: 'sync', request: { kind: 'sync', requestId, feedUrl },
    items: { create: { key: 'feed-plan', groupOrder: 0, step: -1, kind: 'feed-plan', source: 'rf39', title: 'Загрузка XML CRM RF39', payload: {} } },
  } });
  await tx.feedSyncSetting.update({ where: { id: 'rf39' }, data: { lastJobId: job.id, lastError: null } });
  return job.id;
}
export async function startRf39FeedSync(ownerId: string, requestId: string) {
  const id = await db.$transaction(async tx => {
    await lock(tx);
    const previous = await tx.importJob.findUnique({ where: { ownerId_requestId: { ownerId, requestId } } });
    if (previous) {
      if (previous.kind !== 'sync') throw createError({ statusCode: 409, data: { message: 'Этот идентификатор уже занят другим заданием.' } });
      return previous.id;
    }
    const running = await tx.importJob.findFirst({ where: { kind: 'sync', status: { in: active } } });
    if (running) {
      if (running.ownerId === ownerId) return running.id;
      throw createError({ statusCode: 409, data: { message: 'Синхронизация CRM уже запущена другим администратором.' } });
    }
    const settings = await tx.feedSyncSetting.upsert({ where: { id: 'rf39' }, update: {}, create: { id: 'rf39', ownerId, url: defaultUrl() } });
    return enqueue(tx, ownerId, requestId, settings.url);
  });
  return getImportJob(ownerId, id, false);
}

export async function scheduleRf39FeedSync() {
  const settings = await db.feedSyncSetting.findUnique({ where: { id: 'rf39' } });
  if (!settings?.enabled || !settings.nextRunAt || settings.nextRunAt > new Date()) return;
  await db.$transaction(async tx => {
    await lock(tx);
    const current = await tx.feedSyncSetting.findUnique({ where: { id: 'rf39' } });
    if (!current?.enabled || !current.nextRunAt || current.nextRunAt > new Date()) return;
    if (!await tx.importJob.findFirst({ where: { kind: 'sync', status: { in: active } } }))
      await enqueue(tx, current.ownerId, randomUUID(), current.url);
    await tx.feedSyncSetting.update({ where: { id: 'rf39' }, data: { nextRunAt: new Date(Date.now() + current.intervalMinutes * 60000) } });
  });
}
