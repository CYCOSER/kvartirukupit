export default defineEventHandler(async (event) => {
  const base = useRuntimeConfig(event).public.siteUrl.replace(/\/$/, '');
  const items = await db.property.findMany({
    where: { published: true },
    select: { slug: true, updatedAt: true },
  });
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  setHeader(event, 'Content-Type', 'application/xml');
  const articles = await db.article.findMany({
    where: { published: true },
    select: { slug: true, updatedAt: true },
  });
  const pages = ['', '/elite', '/catalog', '/blog', '/privacy'].map((path) => ({
    path,
    lastmod: '',
  }));
  return (
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    [
      ...pages,
      ...items.map((p) => ({
        path: '/catalog/' + p.slug,
        lastmod: p.updatedAt.toISOString(),
      })),
      ...articles.map((a) => ({
        path: '/blog/' + a.slug,
        lastmod: a.updatedAt.toISOString(),
      })),
    ]
      .map(
        ({ path, lastmod }) =>
          `<url><loc>${escape(base + path)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`,
      )
      .join('') +
    '</urlset>'
  );
});
