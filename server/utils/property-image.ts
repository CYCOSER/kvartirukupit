import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createError } from 'h3';

export async function readPropertyImage(file: string) {
  const upload = file.match(/^\/uploads\/([0-9a-f-]{36}\.webp)$/);
  const local = file.match(/^\/images\/((?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:webp|png|jpe?g))$/);
  if (!upload && !local)
    throw createError({ statusCode: 400, data: { message: 'Сначала загрузите изображение в галерею объекта.' } });
  const path = upload
    ? resolve(process.env.UPLOAD_DIR || '.data/uploads', upload[1]!)
    : resolve(process.env.NODE_ENV === 'production' ? '.output/public/images' : 'public/images', local![1]!);
  try { return await readFile(path); }
  catch { throw createError({ statusCode: 400, data: { message: 'Исходное изображение не найдено.' } }); }
}
