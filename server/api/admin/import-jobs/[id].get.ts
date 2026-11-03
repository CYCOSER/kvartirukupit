import { defineEventHandler, getRouterParam } from 'h3';
import { getImportJob } from '../../../utils/import-jobs';
import { requireAdmin } from '../../../utils/security';

export default defineEventHandler(async event => getImportJob((await requireAdmin(event)).id, getRouterParam(event, 'id')!));
