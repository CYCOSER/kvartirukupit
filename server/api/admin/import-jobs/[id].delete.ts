import { defineEventHandler, getRouterParam } from 'h3';
import { deleteImportJob } from '../../../utils/import-jobs';
import { requireAdmin } from '../../../utils/security';

export default defineEventHandler(async event => deleteImportJob((await requireAdmin(event)).id, getRouterParam(event, 'id')!));
