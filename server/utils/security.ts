import { createHash, randomBytes } from 'node:crypto';
import type { H3Event } from 'h3';
import { db } from './db';
import { enforceRateLimit } from './rate-limit';
export function limit(
  event: H3Event,
  scope: string,
  max = 6,
  duration = 600000,
) {
  enforceRateLimit(event, scope, max, duration);
}
export function checkOrigin(event: H3Event) {
  const expected = new URL(useRuntimeConfig(event).public.siteUrl).origin;
  if (getHeader(event, 'origin') !== expected)
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
}
const digest = (token: string) =>
  createHash('sha256').update(token).digest('hex');
export async function currentUser(event: H3Event) {
  const token = getCookie(event, 'kv_session');
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { id: digest(token) },
    include: { user: { select: { id: true, email: true } } },
  });
  return session && session.expiresAt > new Date() ? session.user : null;
}
export async function requireAdmin(event: H3Event) {
  const user = await currentUser(event);
  if (!user)
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  return user;
}
export async function createSession(event: H3Event, userId: string) {
  const token = randomBytes(32).toString('hex');
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.session.create({
    data: {
      id: digest(token),
      userId,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  setCookie(event, 'kv_session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure:
      process.env.NODE_ENV === 'production' &&
      useRuntimeConfig(event).public.siteUrl.startsWith('https://'),
    path: '/',
    maxAge: 86400,
  });
}
export async function endSession(event: H3Event) {
  const token = getCookie(event, 'kv_session');
  if (token) await db.session.deleteMany({ where: { id: digest(token) } });
  deleteCookie(event, 'kv_session', { path: '/' });
}
