export default defineEventHandler(() =>
  db.lead.findMany({
    orderBy: { createdAt: 'desc' },
    include: { property: { select: { title: true } } },
  }),
);
