export default defineEventHandler(async (event) => {
  setHeader(event, 'X-Content-Type-Options', 'nosniff');
  setHeader(event, 'Referrer-Policy', 'strict-origin-when-cross-origin');
  setHeader(event, 'X-Frame-Options', 'DENY');
  setHeader(
    event,
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  );
  if (process.env.NODE_ENV === 'production')
    setHeader(
      event,
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: https://tile.openstreetmap.org https://xn--d1aqf.xn--p1ai https://*.xn--d1aqf.xn--p1ai https://domrf.ru https://*.domrf.ru; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
    );
  if (useRuntimeConfig(event).public.siteUrl.startsWith('https://'))
    setHeader(
      event,
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
  const path = getRequestURL(event).pathname;
  if (
    ['POST', 'PUT', 'PATCH'].includes(event.method) &&
    path.startsWith('/api/') &&
    path !== '/api/admin/logout'
  ) {
    const length = getHeader(event, 'content-length');
    const max =
      (path.endsWith('/images') || path.endsWith('/image')) &&
      event.method === 'POST'
        ? 12 * 1024 * 1024
        : 64 * 1024;
    if (!length || !/^\d+$/.test(length))
      throw createError({
        statusCode: 411,
        statusMessage: 'Content length required',
      });
    if (Number(length) > max)
      throw createError({
        statusCode: 413,
        statusMessage: 'Request too large',
      });
  }
  if (path.startsWith('/api/admin/')) {
    setHeader(event, 'Cache-Control', 'no-store');
    if (event.method !== 'GET') checkOrigin(event);
    if (path !== '/api/admin/login') await requireAdmin(event);
  }
});
