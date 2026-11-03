import { expect, type BrowserContext, type Page } from '@playwright/test';
import type { ImportJobItemView, ImportJobRequest, ImportJobView } from '../../../shared/import-job';

type Imported = { id: string; created: boolean; linked?: boolean; warnings: string[] };
type FixtureOptions = {
  importItem?: (source: 'rf39' | 'nmarket', item: { id: string | number; title?: string }, snapshot?: 'saved') => Promise<Imported> | Imported;
  create?: (request: ImportJobRequest, job: ImportJobView) => void;
};

export async function openImportResults(page: Page) {
  const results = page.locator('.import-page .import-results');
  await expect(results.locator('summary')).toBeVisible();
  if (!await results.evaluate(element => (element as HTMLDetailsElement).open)) await results.locator('summary').click();
}

export function jobFixture(request: ImportJobRequest, index = 1): ImportJobView {
  const date = new Date(Date.UTC(2026, 10, 2, 12, 0, index)).toISOString();
  return {
    id: `fixture-job-${index}`, kind: request.kind, status: 'queued',
    title: request.kind === 'import' ? `Импорт из ${request.source === 'rf39' ? 'CRM RF39' : 'Нмаркета'}` : `Поиск квартир: ${request.complexIds.length} ЖК`,
    ...(request.kind === 'import' ? { source: request.source } : { complexIds: request.complexIds, preferredSource: request.preferredSource }),
    snapshot: request.snapshot, createdAt: date, updatedAt: date, finishedAt: null, stopRequested: false,
    total: request.kind === 'import' ? request.items.length : 0, processed: 0, created: 0, linked: 0, existing: 0, failed: 0,
    activeTitle: '', error: null, canRetry: false, items: [],
  };
}

// The browser sees server-owned progress; orchestration is covered by worker tests.
export async function mockImportJobs(target: Page | BrowserContext, options: FixtureOptions = {}) {
  const jobs: ImportJobView[] = [], requests: ImportJobRequest[] = [], stops: string[] = [];
  await target.route('**/api/admin/import-jobs**', async route => {
    const path = new URL(route.request().url()).pathname;
    const suffix = path.slice('/api/admin/import-jobs'.length);
    const method = route.request().method();
    if (!suffix && method === 'POST') {
      const request = route.request().postDataJSON() as ImportJobRequest;
      requests.push(request);
      const job = jobFixture(request, jobs.length + 1);
      jobs.unshift(job);
      if (options.create) options.create(request, job);
      else if (request.kind === 'import') {
        for (const [index, item] of request.items.entries()) {
          const result: ImportJobItemView = {
            id: `${job.id}-item-${index}`, kind: 'import', title: item.title || String(item.id),
            source: request.source, sourceId: item.id, status: 'completed', created: false, linked: false, warnings: [],
          };
          try {
            const imported = await options.importItem?.(request.source, item, request.snapshot) || { id: `draft-${item.id}`, created: true, warnings: [] };
            Object.assign(result, { propertyId: imported.id, created: imported.created, linked: !!imported.linked, warnings: imported.warnings });
            if (imported.created) job.created++;
            else if (imported.linked) job.linked++;
            else job.existing++;
          } catch (error) {
            result.status = 'failed'; result.error = error instanceof Error ? error.message : String(error); job.failed++;
          }
          job.items!.push(result); job.processed++;
        }
        job.status = 'completed'; job.canRetry = job.failed > 0; job.finishedAt = new Date().toISOString();
      }
      const { items, ...summary } = job;
      await route.fulfill({ json: summary });
      return;
    }
    if (!suffix && method === 'GET') {
      await route.fulfill({ json: jobs.map(({ items, ...summary }) => summary) });
      return;
    }
    const [id, action] = suffix.slice(1).split('/');
    const job = jobs.find(job => job.id === id);
    if (!job) { await route.fulfill({ status: 404, json: { message: 'Unknown fixture job' } }); return; }
    if (!action && method === 'DELETE') {
      if (['queued', 'running'].includes(job.status)) {
        await route.fulfill({ status: 409, json: { data: { message: 'Сначала остановите задачу.' } } });
      } else {
        jobs.splice(jobs.indexOf(job), 1);
        await route.fulfill({ json: { ok: true } });
      }
      return;
    }
    if (action === 'stop' && method === 'POST') {
      stops.push(job.id); job.stopRequested = true; job.updatedAt = new Date().toISOString();
      const { items, ...summary } = job;
      await route.fulfill({ json: summary });
      return;
    }
    await route.fulfill({ json: job });
  });
  return { jobs, requests, stops };
}
