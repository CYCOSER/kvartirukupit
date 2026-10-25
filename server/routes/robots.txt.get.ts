export default defineEventHandler((event) => {
  setHeader(event, 'Content-Type', 'text/plain');
  return `User-agent: *\nDisallow: /api/\nDisallow: /morskoy-kabinet-7q4x/\nSitemap: ${useRuntimeConfig(event).public.siteUrl}/sitemap.xml`;
});
