import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name') || '';
  if (!/^[0-9a-f-]{36}\.webp$/.test(name))
    throw createError({ statusCode: 404, statusMessage: 'Not found' });
  try {
    const file = await readFile(
      resolve(process.env.UPLOAD_DIR || '.data/uploads', name),
    );
    setHeader(event, 'Content-Type', 'image/webp');
    setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');
    return file;
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Not found' });
  }
});
