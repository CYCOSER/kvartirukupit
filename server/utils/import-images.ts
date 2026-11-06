import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { db } from './db';
import { convertUploadedImage, isFloorPlanImage, prepareFloorPlanImage } from './image';
import { rf39ImageUrl } from './rf39-data';
import { nmarketImageUrl } from './nmarket-data';
import { rf39ReadBody } from './rf39';
import { importInfrastructureError } from './import-execution';
import { propertyImageFingerprint } from './image-fingerprint';

type CachedImage = {
  url: string; contentHash: string; contentType: string; originalFile: string;
  etag: string | null; lastModified: string | null; checkedAt: Date;
  planFile: string | null; planHueShift: number | null; detectedPlan: boolean | null;
};
type PreparedImage = { file: string; originalFile: string; hueShift: number; kind: 'photo' | 'plan'; alt: string; order: number };
type DraftImages = { imageUrls: string[]; planImageUrls: string[]; imagesIncomplete?: boolean; data: { title: string; type?: string; housingMarket?: string | null } };

function limit(concurrency: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) await new Promise<void>(resolve => waiting.push(resolve));
    else active++;
    try { return await work(); }
    finally { const next = waiting.shift(); if (next) next(); else active--; }
  };
}
// Keep a download slot until conversion completes, so queued images cannot retain unlimited buffers.
const downloads = limit(6), transformations = limit(2);
const loading = new Map<string, Promise<CachedImage>>();
const converting = new Map<string, Promise<void>>();
const preparingPlans = new Map<string, Promise<{ file: string; hueShift: number }>>();
const detectingPlans = new Map<string, Promise<boolean>>();
const day = 24 * 60 * 60 * 1000;
const originalName = (hash: string) => `import-v1-${hash}.webp`;
const planName = (hash: string) => `import-v1-${hash}-plan.webp`;
const validHash = (hash: string) => /^[a-f0-9]{64}$/.test(hash);
async function exists(path: string) {
  try { await access(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

async function writeImmutable(dir: string, name: string, bytes: Buffer) {
  // Shared import files survive failed cards; deleting one could break another card's gallery.
  await mkdir(dir, { recursive: true });
  const temporary = resolve(dir, `.import-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    if (!await exists(resolve(dir, name))) await rename(temporary, resolve(dir, name));
  } finally { await unlink(temporary).catch(() => {}); }
}

async function originalImage(url: string, dir: string): Promise<CachedImage> {
  const key = `${dir}\0${url}`;
  const pending = loading.get(key);
  if (pending) return pending;
  const promise = downloads(async () => {
    let cached = await db.importImageCache.findUnique({ where: { url } });
    if (cached && (!validHash(cached.contentHash) || cached.originalFile !== `/uploads/${originalName(cached.contentHash)}` ||
      !await exists(resolve(dir, originalName(cached.contentHash))))) cached = null;
    if (cached && cached.checkedAt.getTime() > Date.now() - day) return cached;
    const headers: Record<string, string> = {};
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;
    const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (response.status === 304 && cached) {
      const checkedAt = new Date();
      await db.importImageCache.updateMany({ where: { url, contentHash: cached.contentHash }, data: { checkedAt } });
      return { ...cached, checkedAt };
    }
    const bytes = await rf39ReadBody(response, 10 * 1024 * 1024);
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || '';
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const name = originalName(contentHash), conversionKey = `${dir}\0${contentHash}`;
    let converted = converting.get(conversionKey);
    if (!converted) {
      converted = transformations(async () => {
        if (!await exists(resolve(dir, name))) await writeImmutable(dir, name, await convertUploadedImage(bytes, contentType));
      });
      converting.set(conversionKey, converted);
      void converted.finally(() => converting.delete(conversionKey)).catch(() => {});
    }
    await converted;
    const data: CachedImage = {
      url, contentHash, contentType, originalFile: `/uploads/${name}`,
      etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'), checkedAt: new Date(),
      planFile: cached?.contentHash === contentHash ? cached.planFile : null,
      planHueShift: cached?.contentHash === contentHash ? cached.planHueShift : null,
      detectedPlan: cached?.contentHash === contentHash ? cached.detectedPlan : null,
    };
    return db.importImageCache.upsert({ where: { url }, create: data, update: data });
  });
  loading.set(key, promise);
  try { return await promise; }
  finally { loading.delete(key); }
}

async function detectPlan(image: CachedImage, dir: string) {
  if (image.detectedPlan !== null) return image.detectedPlan;
  const key = `${dir}\0${image.contentHash}`;
  let pending = detectingPlans.get(key);
  if (!pending) {
    pending = transformations(async () => isFloorPlanImage(await readFile(resolve(dir, originalName(image.contentHash)))));
    detectingPlans.set(key, pending);
    void pending.finally(() => detectingPlans.delete(key)).catch(() => {});
  }
  const detectedPlan = await pending;
  await db.importImageCache.updateMany({ where: { url: image.url, contentHash: image.contentHash }, data: { detectedPlan } });
  return detectedPlan;
}

async function planImage(image: CachedImage, dir: string) {
  const name = planName(image.contentHash), file = `/uploads/${name}`;
  if (image.planFile === file && image.planHueShift !== null && await exists(resolve(dir, name)))
    return { file, hueShift: image.planHueShift };
  const key = `${dir}\0${image.contentHash}`;
  let pending = preparingPlans.get(key);
  if (!pending) {
    pending = transformations(async () => {
      const plan = await prepareFloorPlanImage(await readFile(resolve(dir, originalName(image.contentHash))));
      await writeImmutable(dir, name, plan.buffer);
      return { file, hueShift: plan.hueShift };
    });
    preparingPlans.set(key, pending);
    void pending.finally(() => preparingPlans.delete(key)).catch(() => {});
  }
  const plan = await pending;
  await db.importImageCache.updateMany({ where: { url: image.url, contentHash: image.contentHash }, data: { planFile: plan.file, planHueShift: plan.hueShift } });
  return plan;
}

export async function prepareImportImages(draft: DraftImages, detectPlans = false): Promise<{ images: PreparedImage[]; warnings: string[]; complete: boolean }> {
  const dir = resolve(process.env.UPLOAD_DIR || '.data/uploads');
  const warnings: string[] = [], plans = new Set(draft.planImageUrls);
  const plansOnly = draft.data.type === 'apartment' && draft.data.housingMarket === 'newbuild';
  const urls = [...new Set(draft.imageUrls)].filter(input => !plansOnly || plans.has(input) ||
    rf39ImageUrl(input)?.includes('/images/objects/layouts/'));
  if (urls.length > 100) warnings.push(`В галерею можно перенести только первые 100 ${plansOnly ? 'планировок' : 'фотографий'}.`);
  const settled = await Promise.allSettled(urls.slice(0, 100).map(async (input, index) => {
    try {
      const url = rf39ImageUrl(input) || nmarketImageUrl(input);
      if (!url) throw new Error('Invalid image URL');
      const cached = await originalImage(url, dir);
      const isPlan = plans.has(input) || ((detectPlans || plansOnly) && await detectPlan(cached, dir));
      if (plansOnly && !isPlan) return null;
      const hash = await propertyImageFingerprint(cached.originalFile);
      const image = isPlan ? await planImage(cached, dir) : { file: cached.originalFile, hueShift: 0 };
      return { ...image, originalFile: cached.originalFile, kind: isPlan ? 'plan' as const : 'photo' as const, hash };
    } catch (error) {
      if (importInfrastructureError(error) || ['ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'EMFILE'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
      return { warning: `Не удалось загрузить ${plansOnly ? 'планировку' : 'фотографию'} №${index + 1}. Она пропущена.` };
    }
  }));
  const fatal = settled.find(result => result.status === 'rejected');
  if (fatal?.status === 'rejected') throw fatal.reason;
  const images: PreparedImage[] = [], hashes = new Map<string, number>();
  for (const entry of settled) {
    if (entry.status !== 'fulfilled') continue;
    const result = entry.value;
    if (!result) continue;
    if ('warning' in result) { if (result.warning) warnings.push(result.warning); continue; }
    const previous = hashes.get(result.hash);
    const order = previous ?? images.length;
    const image: PreparedImage = { file: result.file, originalFile: result.originalFile, hueShift: result.hueShift,
      kind: result.kind, alt: draft.data.title.slice(0, 200), order };
    if (previous === undefined) { hashes.set(result.hash, order); images.push(image); }
    else if (image.kind === 'plan') images[previous] = image;
  }
  if (!images.length) warnings.push(`В источнике нет доступных ${plansOnly ? 'планировок' : 'фотографий'}. Добавьте их в карточку.`);
  return { images, warnings, complete: !draft.imagesIncomplete && !warnings.length };
}
