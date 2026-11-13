import { createHash, timingSafeEqual } from 'node:crypto';
import { createError, getHeader, readRawBody, setHeader, type H3Event } from 'h3';

export async function requireAgent(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store');
  const expected = useRuntimeConfig(event).agentApiToken;
  if (typeof expected !== 'string' || !/^[\x21-\x7e]{32,}$/.test(expected))
    throw createError({ statusCode: 503, statusMessage: 'Agent API is disabled' });

  const token = getHeader(event, 'authorization')?.match(/^Bearer ([\x21-\x7e]+)$/i)?.[1];
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!token || !timingSafeEqual(digest(token), digest(expected)))
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });

  if (['POST', 'PUT', 'PATCH'].includes(event.method)) {
    const imageUpload = event.method === 'POST' && /^\/api\/agent\/v1\/articles\/[^/]+\/image\/?$/.test(event.path.split('?', 1)[0]);
    const contentType = imageUpload ? 'multipart/form-data' : 'application/json';
    if (getHeader(event, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== contentType)
      throw createError({ statusCode: 415, statusMessage: `Content-Type must be ${contentType}` });
    const length = getHeader(event, 'content-length');
    if (!length || !/^\d+$/.test(length))
      throw createError({ statusCode: 411, statusMessage: 'Content length required' });
    const max = imageUpload ? 12 * 1024 * 1024 : 256 * 1024;
    if (Number(length) > max)
      throw createError({ statusCode: 413, statusMessage: 'Request too large' });
    // h3 caches the raw body for the route's readBody call.
    if (((await readRawBody(event, false))?.length ?? 0) > max)
      throw createError({ statusCode: 413, statusMessage: 'Request too large' });
  }
}
