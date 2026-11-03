import { defineEventHandler, getRouterParam } from 'h3';
import { stopImportJob } from '../../../../utils/import-jobs';
import { requireAdmin } from '../../../../utils/security';

export default defineEventHandler(async event => stopImportJob((await requireAdmin(event)).id, getRouterParam(event, 'id')!));
