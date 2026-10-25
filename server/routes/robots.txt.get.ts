export default defineEventHandler((event) => {
  setHeader(event, 'Content-Type', 'text/plain');
  return `User-agent: *\nDisallow: /api/\nDisallow: /admin-console-\nSitemap: ${useRuntimeConfig(event).public.siteUrl}/sitemap.xml`;
});
