import { z } from 'zod';

export type ImportSource = 'rf39' | 'nmarket';
export type ImportJobStatus = 'queued' | 'running' | 'completed' | 'stopped' | 'failed';
export type ImportJobItemStatus = 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
const requestId = z.string().uuid();
const sourceId = z.union([z.number().int().positive().max(Number.MAX_SAFE_INTEGER), z.string().min(1).max(100)]);
export const importJobRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    requestId, kind: z.literal('import'), source: z.enum(['rf39', 'nmarket']),
    items: z.array(z.object({ id: sourceId, title: z.string().trim().max(300).optional() }).strict()).min(1).max(10000),
    snapshot: z.literal('saved').optional(),
  }).strict(),
  z.object({
    requestId, kind: z.literal('apartments'), complexIds: z.array(z.string().trim().min(1).max(100)).min(1).max(10000),
    snapshot: z.literal('saved').optional(), preferredSource: z.enum(['rf39', 'nmarket']).default('nmarket'),
  }).strict(),
]).superRefine((value, context) => {
  if (value.kind !== 'import') return;
  for (const [index, item] of value.items.entries()) {
    const valid = value.source === 'rf39' ? typeof item.id === 'number' : typeof item.id === 'string' && /^(?:apartment|complex):\d{1,20}$/.test(item.id);
    if (!valid) context.addIssue({ code: z.ZodIssueCode.custom, path: ['items', index, 'id'], message: 'Invalid source ID' });
  }
});
export const importJobRetrySchema = z.object({ requestId }).strict();
export type ImportJobRequest = z.infer<typeof importJobRequestSchema>;
export type ImportJobItemView = {
  id: string; kind: 'search' | 'import' | 'rescan'; title: string;
  complexId?: string; complexTitle?: string; source: 'local' | ImportSource;
  sourceId?: string | number; layoutId?: number; status: ImportJobItemStatus;
  propertyId?: string; created: boolean; linked: boolean; error?: string; warnings: string[];
};
export type ImportJobView = {
  id: string; kind: ImportJobRequest['kind']; status: ImportJobStatus; title: string;
  source?: ImportSource; snapshot?: 'saved'; preferredSource?: ImportSource; complexIds?: string[];
  createdAt: string; updatedAt: string; finishedAt: string | null; stopRequested: boolean;
  total: number; processed: number; created: number; linked: number; existing: number; failed: number;
  activeTitle: string; error: string | null; canRetry: boolean; items?: ImportJobItemView[];
};
