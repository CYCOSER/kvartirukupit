import { defineEventHandler } from 'h3';
import { clientIp, enforceRateLimit } from '../utils/rate-limit';

export default defineEventHandler((event) => {
  // Nuxt forwards this server context to API requests made while rendering a page.
  const ip = clientIp(event);
  if (ip) event.context.clientAddress = ip;
  const path = event.path.split('?', 1)[0];
  if (event.method === 'POST' && /^\/api\/articles\/[^/]+\/(?:view|useful)\/?$/.test(path)) {
    checkOrigin(event);
    enforceRateLimit(event, 'article-statistics', 30, 60000);
  }
  if (
    ['GET', 'HEAD'].includes(event.method) &&
    (/^\/api\/(?:properties|articles)(?:\/|$)/.test(path) || /^\/api\/map\/search\/?$/.test(path))
  ) enforceRateLimit(event, 'public-api', 120, 60000);
});
