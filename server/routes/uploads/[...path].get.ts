import { defineEventHandler, getRequestURL, createError, send, setHeader } from 'h3';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { uploadFilePattern } from '../../utils/property-image';

export default defineEventHandler(async (event) => {
  const pathname = getRequestURL(event).pathname;
  if (!pathname.startsWith('/uploads/')) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' });
  }
  const file = pathname.slice('/uploads/'.length);
  if (!file || file.includes('/') || file.includes('\\') || !uploadFilePattern.test(file)) {
    throw createError({ statusCode: 400, statusMessage: 'Некорректный путь к изображению.' });
  }
  const dir = process.env.UPLOAD_DIR || '.data/uploads';
  const filePath = resolve(dir, file);
  const root = resolve(dir);
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    throw createError({ statusCode: 400, statusMessage: 'Некорректный путь к изображению.' });
  }
  let data: Buffer;
  try {
    data = await readFile(filePath);
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Изображение не найдено.' });
  }
  setHeader(event, 'content-type', 'image/webp');
  setHeader(event, 'cache-control', 'public, max-age=31536000, immutable');
  return send(event, data);
});
