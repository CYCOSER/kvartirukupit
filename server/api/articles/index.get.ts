export default defineEventHandler(() =>
  db.article.findMany({
    where: {
      published: true,
      OR: [{ publishedAt: null }, { publishedAt: { lte: new Date() } }],
    },
    orderBy: { publishedAt: 'desc' },
    select: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      image: true,
      publishedAt: true,
    },
  }),
);
