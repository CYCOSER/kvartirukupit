import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createError } from 'h3';

export const uploadFilePattern = /^(?:[0-9a-f-]{36}|import-v1-[0-9a-f]{64}(?:-plan)?)\.webp$/;

export async function readPropertyImage(file: string) {
  const upload = file.startsWith('/uploads/') ? file.slice('/uploads/'.length) : '';
  const isUpload = uploadFilePattern.test(upload);
  const local = file.match(/^\/images\/((?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:webp|png|jpe?g))$/);
  if (!isUpload && !local)
    throw createError({ statusCode: 400, data: { message: 'Сначала загрузите изображение в галерею объекта.' } });
  const path = isUpload
    ? resolve(process.env.UPLOAD_DIR || '.data/uploads', upload)
    : resolve(process.env.NODE_ENV === 'production' ? '.output/public/images' : 'public/images', local![1]!);
  try { return await readFile(path); }
  catch { throw createError({ statusCode: 400, data: { message: 'Исходное изображение не найдено.' } }); }
}
