import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createError } from 'h3';
import sharp from 'sharp';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { propertyImagePath } from './property-image';

let active = 0;
const waiting: (() => void)[] = [];
const loading = new Map<string, Promise<string>>();

function fileError(error: unknown): never {
  if (['ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'EMFILE'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
  throw createError({ statusCode: 400, data: { message: 'Не удалось прочитать изображение для проверки дублей.' }, cause: error });
}

async function fingerprint(input: Buffer | string) {
  // Two full-resolution decodes at a time keep large galleries within the memory limit.
  if (active >= 2) await new Promise<void>(resolve => waiting.push(resolve));
  else active++;
  try {
    const bytes = typeof input === 'string' ? await readFile(input) : input;
    const { data, info } = await sharp(bytes, { limitInputPixels: 40000000 })
      .rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return createHash('sha256').update(`pixels-v1:${info.width}:${info.height}:`).update(data).digest('hex');
  } catch (error) { return fileError(error); }
  finally { const next = waiting.shift(); if (next) next(); else active--; }
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
