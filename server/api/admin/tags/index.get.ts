export default defineEventHandler(() =>
  db.tag.findMany({ orderBy: { name: "asc" } }),
);
