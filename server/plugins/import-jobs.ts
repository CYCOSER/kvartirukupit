import { processNextImportJob } from '../utils/import-jobs';

export default defineNitroPlugin(nitroApp => {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  let pending: Promise<void> | undefined;
  const config = useRuntimeConfig();
  async function tick() {
    let busy = false;
    try { busy = await processNextImportJob(config); }
    catch (error) {
      console.error('[import-jobs] Worker paused; unfinished work will resume after its lease expires.', (error as { code?: string })?.code || (error as Error)?.name || 'Error');
    }
    if (!stopped) timer = setTimeout(() => { pending = tick(); }, busy ? 100 : 3000);
  }
  timer = setTimeout(() => { pending = tick(); }, 1000);
  nitroApp.hooks.hook('close', async () => { stopped = true; clearTimeout(timer); await pending; });
});
