import { isIP } from 'node:net';
import { createError, getHeader, getRequestIP, setHeader, type H3Event } from 'h3';

// shortcut: counters belong to one process, use a shared store when adding web replicas.
const attempts = new Map<string, { count: number; until: number }>();
const maxEntries = 10000;
let nextCleanup = 0;

export function clientIp(event: H3Event) {
  const forwarded = String(useRuntimeConfig(event).trustProxy) === 'true'
    ? getHeader(event, 'x-real-ip')
    : undefined;
  return forwarded && isIP(forwarded)
    ? forwarded
    : getRequestIP(event, { xForwardedFor: false });
}

export function enforceRateLimit(
  event: H3Event,
  scope: string,
  max = 6,
  duration = 600000,
) {
  const ip = clientIp(event);
  // Nitro's internal requests may have neither a socket nor a visitor context.
  if (!ip) return;
  const now = Date.now();
  if (now >= nextCleanup) {
    for (const [key, entry] of attempts)
      if (entry.until <= now) attempts.delete(key);
    nextCleanup = now + 60000;
  }
  const key = scope + ':' + ip;
  let entry = attempts.get(key);
  if (entry && entry.until <= now) {
    attempts.delete(key);
    entry = undefined;
  }
  if (!entry && attempts.size < maxEntries) {
    entry = { count: 0, until: now + duration };
    attempts.set(key, entry);
  }
  if (!entry || entry.count >= max) {
    setHeader(event, 'Retry-After', Math.max(1, Math.ceil(((entry?.until ?? nextCleanup) - now) / 1000)));
    setHeader(event, 'Cache-Control', 'no-store');
    throw createError({ statusCode: 429, statusMessage: 'Too many requests' });
  }
  entry.count++;
}
