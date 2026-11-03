import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { importJobRetrySchema } from '../../../../../shared/import-job';
import { retryImportJob } from '../../../../utils/import-jobs';
import { requireAdmin } from '../../../../utils/security';

export default defineEventHandler(async event => {
  const owner = await requireAdmin(event);
  const parsed = importJobRetrySchema.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, data: { message: 'Некорректный запрос повтора.' } });
  return retryImportJob(owner.id, getRouterParam(event, 'id')!, parsed.data.requestId);
});
