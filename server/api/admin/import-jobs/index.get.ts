import { defineEventHandler } from 'h3';
import { listImportJobs } from '../../../utils/import-jobs';
import { requireAdmin } from '../../../utils/security';

export default defineEventHandler(async event => listImportJobs((await requireAdmin(event)).id));
