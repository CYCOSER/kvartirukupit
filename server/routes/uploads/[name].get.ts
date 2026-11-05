import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3';
import { uploadFilePattern } from '../../utils/property-image';
export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name') || '';
  if (!uploadFilePattern.test(name))
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
