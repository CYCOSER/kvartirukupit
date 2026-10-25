export default defineEventHandler(() =>
  db.article.findMany({ orderBy: { updatedAt: 'desc' } }),
);
