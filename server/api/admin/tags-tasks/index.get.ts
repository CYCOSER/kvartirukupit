export default defineEventHandler(() =>
  db.tagTask.findMany({
    include: { tag: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  }),
);
