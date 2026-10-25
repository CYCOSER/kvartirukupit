export default defineEventHandler(async (event) => {
  await db.property.deleteMany({ where: { id: getRouterParam(event, 'id') } });
  // Unlinked upload files are retained to make accidental deletion recoverable from backups.
  return { ok: true };
});
