import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';
import { createError } from 'h3';
import sharp from 'sharp';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { propertyImagePath } from './property-image';

let active = 0;
const waiting: (() => void)[] = [];
const loading = new Map<string, Promise<string>>();
export type PhotoFingerprint = { width: number; height: number; pixels: Buffer };
const loadingPhotos = new Map<string, Promise<PhotoFingerprint | null>>();
const photoSide = 64, photoBytes = photoSide * photoSide * 3;
const photoFeatures = new WeakMap<PhotoFingerprint, { hash: boolean[]; colors: number[] }>();
const cosines = Array.from({ length: 8 }, (_, frequency) =>
  Array.from({ length: 32 }, (_, position) => Math.cos((2 * position + 1) * frequency * Math.PI / 64)));

function fileError(error: unknown): never {
  if (['ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'EMFILE'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
  throw createError({ statusCode: 400, data: { message: 'Не удалось прочитать изображение для проверки дублей.' }, cause: error });
}

async function decode<T>(input: Buffer | string, work: (bytes: Buffer) => Promise<T>) {
  // Two full-resolution decodes at a time keep large galleries within the memory limit.
  if (active >= 2) await new Promise<void>(resolve => waiting.push(resolve));
  else active++;
  try {
    const bytes = typeof input === 'string' ? await readFile(input) : input;
    return await work(bytes);
  } catch (error) { return fileError(error); }
  finally { const next = waiting.shift(); if (next) next(); else active--; }
}

async function fingerprint(input: Buffer | string) {
  return decode(input, async bytes => {
    const { data, info } = await sharp(bytes, { limitInputPixels: 40000000 })
      .rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return createHash('sha256').update(`pixels-v1:${info.width}:${info.height}:`).update(data).digest('hex');
  });
}

export function imageFingerprint(data: Buffer): Promise<string> {
  return fingerprint(data);
}

export async function propertyImageFingerprint(file: string, knownHash?: string, client: Pick<Prisma.TransactionClient, 'imageFingerprint'> = db): Promise<string> {
  const path = propertyImagePath(file);
  const info = await stat(path).catch(fileError);
  const signature = `pixels-v1:${path}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  const key = `${file}\0${signature}`;
  async function compute() {
    const cached = await client.imageFingerprint.findUnique({ where: { file } });
    if (cached?.signature === signature) return cached.hash;
    const hash = knownHash ?? await fingerprint(path);
    await client.imageFingerprint.upsert({ where: { file }, create: { file, signature, hash }, update: { signature, hash } });
    return hash;
  }
  // A transaction must use its own connection, even if the global pool is fully occupied.
  if (client !== db) return compute();
  const pending = loading.get(key);
  if (pending) return pending;
  const promise = compute();
  loading.set(key, promise);
  try { return await promise; }
  finally { loading.delete(key); }
}

async function photoFingerprint(path: string): Promise<PhotoFingerprint | null> {
  return decode(path, async bytes => {
    const image = sharp(bytes, { limitInputPixels: 40000000 });
    const metadata = await image.metadata(), { width, height } = metadata.autoOrient;
    if (width < 96 || height < 96) return null;
    const pixels = await image.rotate().resize(photoSide, photoSide, { fit: 'fill' })
      .flatten({ background: '#fff' }).removeAlpha().toColourspace('srgb').raw().toBuffer();
    let white = 0, neutral = 0, sum = 0, squares = 0, detail = 0;
    for (let y = 0; y < photoSide; y++) for (let x = 0; x < photoSide; x++) {
      const index = (y * photoSide + x) * 3;
      const r = pixels[index]!, g = pixels[index + 1]!, b = pixels[index + 2]!;
      const low = Math.min(r, g, b), high = Math.max(r, g, b), light = (r + g + b) / 3;
      if (low >= 235) white++;
      if (high - low <= 24) neutral++;
      sum += light; squares += light * light;
      for (const next of [x + 1 < photoSide ? index + 3 : -1, y + 1 < photoSide ? index + photoSide * 3 : -1]) {
        if (next >= 0) detail += Math.abs(r - pixels[next]!) + Math.abs(g - pixels[next + 1]!) + Math.abs(b - pixels[next + 2]!);
      }
    }
    const count = photoSide * photoSide;
    // Blank images and drawings must not make distinct plans look like duplicate photographs.
    if (squares / count - (sum / count) ** 2 < 100 || detail / (2 * photoSide * (photoSide - 1) * 3) < 2 ||
      white / count >= 0.45 && neutral / count >= 0.6) return null;
    return { width, height, pixels };
  });
}

function features(photo: PhotoFingerprint) {
  const cached = photoFeatures.get(photo);
  if (cached) return cached;
  const gray = Array.from({ length: 32 * 32 }, (_, i) => {
    const x = i % 32 * 2, y = Math.floor(i / 32) * 2;
    let light = 0;
    for (const offset of [0, 1, photoSide, photoSide + 1]) {
      const index = (y * photoSide + x + offset) * 3;
      light += photo.pixels[index]! * 0.299 + photo.pixels[index + 1]! * 0.587 + photo.pixels[index + 2]! * 0.114;
    }
    return light / 4;
  });
  const coefficients: number[] = [];
  for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
    if (!u && !v) continue;
    let value = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++)
      value += gray[y * 32 + x]! * cosines[u]![x]! * cosines[v]![y]!;
    coefficients.push(value);
  }
  const median = [...coefficients].sort((a, b) => a - b)[31]!;
  const colors: number[] = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) for (let channel = 0; channel < 3; channel++) {
    let total = 0;
    for (let yy = y * 8; yy < (y + 1) * 8; yy++) for (let xx = x * 8; xx < (x + 1) * 8; xx++)
      total += photo.pixels[(yy * photoSide + xx) * 3 + channel]!;
    colors.push(total / 64);
  }
  const result = { hash: coefficients.map(value => value > median), colors };
  photoFeatures.set(photo, result);
  return result;
}

export function samePhoto(left: PhotoFingerprint | null, right: PhotoFingerprint | null) {
  if (!left || !right || left.pixels.length !== photoBytes || right.pixels.length !== photoBytes) return false;
  const a = left.width * right.height, b = right.width * left.height;
  if (Math.abs(a - b) / Math.max(a, b) > 0.02) return false;
  let absolute = 0, squared = 0;
  for (let i = 0; i < photoBytes; i++) {
    const delta = left.pixels[i]! - right.pixels[i]!;
    absolute += Math.abs(delta); squared += delta * delta;
    if (squared > photoBytes * 625) return false;
  }
  if (absolute <= photoBytes * 4.5 && squared <= photoBytes * 36) return true;
  // Reprocessed copies must share both broad structure and color, not just a similar outline.
  const first = features(left), second = features(right);
  let different = 0, colorDifference = 0;
  for (let i = 0; i < first.hash.length; i++) if (first.hash[i] !== second.hash[i] && ++different > 8) return false;
  for (let i = 0; i < first.colors.length; i++) {
    colorDifference += Math.abs(first.colors[i]! - second.colors[i]!);
    if (colorDifference > first.colors.length * 8) return false;
  }
  return true;
}

export async function propertyPhotoFingerprint(file: string, client: Pick<Prisma.TransactionClient, 'imageFingerprint'> = db): Promise<PhotoFingerprint | null> {
  const path = propertyImagePath(file), info = await stat(path).catch(fileError);
  const cacheFile = `photo-v1:${file}`, signature = `photo-v1:${path}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  const key = `${cacheFile}\0${signature}`;
  async function compute() {
    const cached = await client.imageFingerprint.findUnique({ where: { file: cacheFile } });
    if (cached?.signature === signature) {
      try {
        const stored = JSON.parse(cached.hash);
        if (stored === null) return null;
        const pixels = Buffer.from(stored.pixels, 'base64');
        if (Number.isInteger(stored.width) && stored.width >= 96 && Number.isInteger(stored.height) && stored.height >= 96 && pixels.length === photoBytes)
          return { width: stored.width, height: stored.height, pixels };
      } catch { /* Rebuild a malformed cache entry from the original file. */ }
    }
    const result = await photoFingerprint(path);
    const hash = JSON.stringify(result && { ...result, pixels: result.pixels.toString('base64') });
    await client.imageFingerprint.upsert({ where: { file: cacheFile }, create: { file: cacheFile, signature, hash }, update: { signature, hash } });
    return result;
  }
  if (client !== db) return compute();
  const pending = loadingPhotos.get(key);
  if (pending) return pending;
  const promise = compute();
  loadingPhotos.set(key, promise);
  try { return await promise; }
  finally { loadingPhotos.delete(key); }
}

export async function propertyUnitPlanFingerprint(file: string, client: Pick<Prisma.TransactionClient, 'imageFingerprint'> = db): Promise<PhotoFingerprint> {
  const path = propertyImagePath(file), info = await stat(path).catch(fileError);
  const cacheFile = `unit-plan-v1:${file}`, signature = `unit-plan-v1:${path}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  const cached = await client.imageFingerprint.findUnique({ where: { file: cacheFile } });
  if (cached?.signature === signature) {
    try {
      const stored = JSON.parse(cached.hash);
      const pixels = inflateSync(Buffer.from(stored.pixels, 'base64'), { maxOutputLength: 120000000 });
      if (Number.isInteger(stored.width) && stored.width > 0 && Number.isInteger(stored.height) && stored.height > 0 && pixels.length === stored.width * stored.height * 3)
        return { width: stored.width, height: stored.height, pixels };
    } catch { /* Rebuild a malformed cache entry from the original file. */ }
  }
  const result = await decode(path, async bytes => {
    const { data, info } = await sharp(bytes, { limitInputPixels: 40000000 }).rotate()
      .flatten({ background: '#fff' }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, pixels: data };
  });
  const hash = JSON.stringify({ ...result, pixels: deflateSync(result.pixels).toString('base64') });
  await client.imageFingerprint.upsert({ where: { file: cacheFile }, create: { file: cacheFile, signature, hash }, update: { signature, hash } });
  return result;
}

export function sameUnitPlan(left: PhotoFingerprint, right: PhotoFingerprint) {
  if (left.width < 96 || left.height < 96 || left.width !== right.width || left.height !== right.height || left.pixels.length !== right.pixels.length) return false;
  let absolute = 0, squared = 0, ink = 0;
  for (let i = 0; i < left.pixels.length; i++) {
    const delta = Math.abs(left.pixels[i]! - right.pixels[i]!);
    // Allow faint text antialiasing only: moving a dark wall or changing a label's solid strokes fails this limit.
    if (delta > 128) return false;
    absolute += delta; squared += delta * delta;
    if (absolute > left.pixels.length * 0.4 || squared > left.pixels.length * 16) return false;
    if (i % 3 === 0 && Math.max(left.pixels[i]!, left.pixels[i + 1]!, left.pixels[i + 2]!) < 192) ink++;
  }
  return ink >= left.width * left.height * 0.01 && ink <= left.width * left.height * 0.9;
}
