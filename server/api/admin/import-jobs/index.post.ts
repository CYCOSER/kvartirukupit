import { createError, defineEventHandler, readBody } from 'h3';
import { importJobRequestSchema } from '../../../../shared/import-job';
import { createImportJob } from '../../../utils/import-jobs';
import { requireAdmin } from '../../../utils/security';

export default defineEventHandler(async event => {
  const owner = await requireAdmin(event);
  const parsed = importJobRequestSchema.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, data: { message: 'Проверьте выбранные объекты и параметры импорта.' } });
  return createImportJob(owner.id, parsed.data);
});
