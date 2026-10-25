import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createError } from 'h3';
import sharp from 'sharp';
import type { ImageUpscale, PropertyImage } from '@prisma/client';
import { db } from './db';
import { readPropertyImage } from './property-image';

export const needsFullHd = (width: number, height: number) => Math.max(width, height) < 1920 || Math.min(width, height) < 1080;
export const upscaleAvailable = () => process.env.UPSCALE_ENABLED === 'true';
const currentJob = (image: PropertyImage, job: ImageUpscale | null) => job &&
  (job.status === 'completed' ? job.outputFile === image.file : job.sourceFile === image.file);

export function upscaleState(image: PropertyImage & { upscale?: ImageUpscale | null }) {
  const job = image.upscale;
  const relevant = job && currentJob(image, job) && !['skipped', 'cancelled'].includes(job.status);
  return { status: relevant ? job.status : null, error: relevant ? job.error : null, available: upscaleAvailable() };
}

export async function queueUpscale(image: PropertyImage, mode: 'auto' | 'manual') {
  const previous = await db.imageUpscale.findUnique({ where: { imageId: image.id } });
  if (currentJob(image, previous)) {
    if (['queued', 'processing'].includes(previous!.status)) return previous!;
    if (previous!.status === 'completed' && (mode === 'manual' || previous!.mode === 'auto')) return previous!;
    if (mode === 'auto' && (['skipped', 'reverted'].includes(previous!.status) || (previous!.status === 'failed' &&
      (previous!.attempts >= 3 || Date.now() - previous!.updatedAt.getTime() < 60000)))) return previous!;
  }
  const source = await readPropertyImage(image.file);
  const metadata = await sharp(source, { limitInputPixels: 40000000 }).metadata();
  const { width, height } = metadata.autoOrient;
  if (currentJob(image, previous) && previous!.status === 'completed' && !needsFullHd(width, height)) return previous!;
  if (mode === 'manual' && Math.max(width, height) >= 4096)
    throw createError({ statusCode: 400, data: { message: 'Фото уже достигло максимального размера: 4096 px по длинной стороне.' } });
  let status = mode === 'auto' && (!needsFullHd(width, height) || Math.max(width, height) >= 4096) ? 'skipped' : 'queued';
  let error: string | null = null;
  if (status === 'queued' && (source.length > 15 * 1024 * 1024 || width * height > 8000000)) {
    error = 'Для улучшения выберите фото до 8 Мп и 15 МБ.';
    if (mode === 'manual') throw createError({ statusCode: 400, data: { message: error } });
    status = 'failed';
  }
  const data = { sourceFile: image.file, outputFile: null, mode, status, error, token: null,
    attempts: error ? 3 : currentJob(image, previous) && mode === 'auto' && previous!.mode === 'auto' ? previous!.attempts : 0 };
  if (previous) {
    // A concurrent request or worker must not lose its claim.
    await db.imageUpscale.updateMany({ where: { imageId: image.id, updatedAt: previous.updatedAt }, data });
    return db.imageUpscale.findUniqueOrThrow({ where: { imageId: image.id } });
  }
  try { return await db.imageUpscale.create({ data: { imageId: image.id, ...data } }); }
  catch (error) {
    if ((error as { code?: string }).code === 'P2002') return db.imageUpscale.findUniqueOrThrow({ where: { imageId: image.id } });
    throw error;
  }
}

export async function discoverHeroUpscales() {
  const properties = await db.property.findMany({ select: { images: {
    where: { kind: { not: 'plan' } }, orderBy: [{ order: 'asc' }, { id: 'asc' }], take: 1,
  } } });
  for (const property of properties) {
    const image = property.images[0];
    if (!image) continue;
    try { await queueUpscale(image, 'auto'); }
    catch (error) { console.error('[upscale] Cannot queue image', image.id, error instanceof Error ? error.message : error); }
  }
}

export async function processNextUpscale() {
  const job = await db.imageUpscale.findFirst({ where: { status: 'queued' }, orderBy: { updatedAt: 'asc' }, include: { image: true } });
  if (!job) return false;
  const token = randomUUID();
  const claim = await db.imageUpscale.updateMany({ where: { imageId: job.imageId, status: 'queued', updatedAt: job.updatedAt },
    data: { status: 'processing', token, attempts: { increment: 1 }, error: null } });
  if (!claim.count) return true;
  const owned = { imageId: job.imageId, token };
  let path: string | undefined;
  try {
    if (job.image.file !== job.sourceFile) {
      await db.imageUpscale.updateMany({ where: owned, data: { status: 'cancelled', token: null } });
      return true;
    }
    const source = await readPropertyImage(job.sourceFile);
    // This is the private Compose service on this server; never follow redirects to another host.
    const response = await fetch('http://upscale:8080/upscale', {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Upscale-Mode': job.mode },
      body: new Uint8Array(source), signal: AbortSignal.timeout(600000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`Worker HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(buffer, { limitInputPixels: 4096 * 4096 }).metadata();
    if (metadata.format !== 'webp' || !metadata.width || !metadata.height || buffer.length > 40 * 1024 * 1024)
      throw new Error('Invalid worker image');
    const file = '/uploads/' + randomUUID() + '.webp';
    const dir = resolve(process.env.UPLOAD_DIR || '.data/uploads');
    await mkdir(dir, { recursive: true });
    path = resolve(dir, file.slice('/uploads/'.length));
    await writeFile(path, buffer, { flag: 'wx' });
    const applied = await db.$transaction(async tx => {
      // Claim the completion inside the same transaction as the image change.
      const locked = await tx.imageUpscale.updateMany({ where: owned, data: { token: null, status: 'cancelled' } });
      if (!locked.count) return false;
      if (job.mode === 'auto') {
        const hero = await tx.propertyImage.findFirst({ where: { propertyId: job.image.propertyId, kind: { not: 'plan' } },
          orderBy: [{ order: 'asc' }, { id: 'asc' }] });
        if (hero?.id !== job.imageId) return false;
      }
      const changed = await tx.propertyImage.updateMany({ where: { id: job.imageId, file: job.sourceFile, kind: job.image.kind },
        data: { file, originalFile: job.image.originalFile || job.sourceFile } });
      if (!changed.count) return false;
      await tx.imageUpscale.update({ where: { imageId: job.imageId }, data: { status: 'completed', outputFile: file, error: null } });
      return true;
    });
    if (applied) path = undefined;
  } catch (error) {
    console.error('[upscale] Processing failed', job.imageId, error instanceof Error ? error.message : error);
    await db.imageUpscale.updateMany({ where: owned, data: { status: 'failed', token: null,
      error: 'Не удалось улучшить фото. Оригинал сохранён. Попробуйте ещё раз.' } });
  } finally {
    if (path) await unlink(path).catch(() => {});
  }
  return true;
}

export async function recoverUpscales() {
  // Inference times out after 10 minutes; expired leases can safely be retried after a restart.
  await db.imageUpscale.updateMany({ where: { status: 'processing', updatedAt: { lt: new Date(Date.now() - 15 * 60000) } },
    data: { status: 'queued', token: null } });
}
