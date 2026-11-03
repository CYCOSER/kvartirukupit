import type { ImportJobRequest, ImportJobView } from '~/shared/import-job';

export function useImportJobs() {
  const userId = useState<string | null>('admin-user-id', () => null);
  const jobs = useState<ImportJobView[]>('import-jobs', () => []);
  const details = useState<Record<string, ImportJobView>>('import-job-details', () => ({}));
  const errors = useState<Record<string, string>>('import-job-errors', () => ({}));
  const loading = useState<Record<string, boolean>>('import-job-loading', () => ({}));
  const panelOpen = useState('import-jobs-open', () => false);
  const listVersion = useState('import-jobs-list-version', () => 0);
  const message = (error: any) => error.data?.data?.message || error.data?.message || 'Не удалось обновить задачу. Повторите попытку.';

  function reset() {
    listVersion.value++;
    jobs.value = [];
    details.value = {};
    errors.value = {};
    loading.value = {};
    panelOpen.value = false;
  }
  function remember(job: ImportJobView) {
    jobs.value = [job, ...jobs.value.filter(item => item.id !== job.id)]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (job.items) details.value[job.id] = job;
    return job;
  }
  async function refresh() {
    if (!userId.value || loading.value.list) return;
    const owner = userId.value;
    const version = listVersion.value;
    loading.value.list = true;
    try {
      const result = await $fetch<ImportJobView[]>('/api/admin/import-jobs', { retry: 0 });
      if (userId.value !== owner || version !== listVersion.value) return;
      jobs.value = result;
      delete errors.value.list;
    } catch (error: any) {
      if (userId.value !== owner) return;
      if (error.status === 401) { userId.value = null; reset(); }
      else errors.value.list = message(error);
    } finally {
      if (userId.value === owner) loading.value.list = false;
    }
  }
  async function load(id: string, force = false) {
    if (!userId.value || loading.value[id]) return;
    const summary = jobs.value.find(job => job.id === id);
    if (!force && details.value[id] && details.value[id].updatedAt === summary?.updatedAt) return;
    const owner = userId.value;
    loading.value[id] = true;
    try {
      const job = await $fetch<ImportJobView>('/api/admin/import-jobs/' + encodeURIComponent(id), { retry: 0 });
      if (userId.value !== owner) return;
      if (summary && !jobs.value.some(item => item.id === id)) return;
      details.value[id] = job;
      delete errors.value[id];
    } catch (error) {
      if (userId.value === owner && (!summary || jobs.value.some(item => item.id === id))) errors.value[id] = message(error);
    } finally {
      if (userId.value === owner) loading.value[id] = false;
    }
  }
  async function start(input: ImportJobRequest) {
    const owner = userId.value;
    const job = await $fetch<ImportJobView>('/api/admin/import-jobs', { method: 'POST', body: input, retry: 0 });
    if (userId.value === owner) { remember(job); panelOpen.value = true; }
    return job;
  }
  async function stop(id: string) {
    const owner = userId.value;
    const job = await $fetch<ImportJobView>('/api/admin/import-jobs/' + encodeURIComponent(id) + '/stop', { method: 'POST', body: {}, retry: 0 });
    if (userId.value === owner) remember(job);
    return job;
  }
  async function retry(id: string, requestId: string) {
    const owner = userId.value;
    const job = await $fetch<ImportJobView>('/api/admin/import-jobs/' + encodeURIComponent(id) + '/retry', { method: 'POST', body: { requestId }, retry: 0 });
    if (userId.value === owner) { remember(job); panelOpen.value = true; }
    return job;
  }
  async function remove(id: string) {
    const owner = userId.value;
    await $fetch('/api/admin/import-jobs/' + encodeURIComponent(id), { method: 'DELETE', retry: 0 });
    if (userId.value !== owner) return;
    listVersion.value++;
    jobs.value = jobs.value.filter(job => job.id !== id);
    delete details.value[id];
    delete errors.value[id];
  }
  return { jobs, details, errors, panelOpen, refresh, load, start, stop, retry, remove, reset };
}
