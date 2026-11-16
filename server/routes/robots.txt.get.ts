export default defineEventHandler((event) => {
  setHeader(event, 'Content-Type', 'text/plain');
  const siteUrl = new URL(useRuntimeConfig(event).public.siteUrl).origin;
  return `User-agent: *\nDisallow: /api/\nDisallow: /admin-console-\nSitemap: ${siteUrl}/sitemap.xml`;
});
