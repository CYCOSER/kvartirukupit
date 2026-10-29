import { defineEventHandler, getRequestURL, createError, send, setHeader } from 'h3';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const UPLOAD_FILE = /^[0-9a-f-]{36}\.webp$/;

export default defineEventHandler(async (event) => {
  const pathname = getRequestURL(event).pathname;
  if (!pathname.startsWith('/uploads/')) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' });
  }
  const file = pathname.slice('/uploads/'.length);
  if (!file || file.includes('/') || file.includes('\\') || !UPLOAD_FILE.test(file)) {
    throw createError({ statusCode: 400, statusMessage: 'Некорректный путь к изображению.' });
  }
  const dir = process.env.UPLOAD_DIR || '.data/uploads';
  const filePath = resolve(dir, file);
  const root = resolve(dir);
  if (filePath !== root && !filePath.startsWith(root + '/')) {
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
