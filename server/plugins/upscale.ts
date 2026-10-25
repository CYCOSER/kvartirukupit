import { discoverHeroUpscales, processNextUpscale, recoverUpscales, upscaleAvailable } from '../utils/upscale';

export default defineNitroPlugin(nitroApp => {
  if (!upscaleAvailable()) return;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  let lastScan = 0;
  async function tick() {
    try {
      if (Date.now() - lastScan > 30000) {
        await recoverUpscales();
        await discoverHeroUpscales();
        lastScan = Date.now();
      }
      if (!stopped && await processNextUpscale()) {
        if (!stopped) timer = setTimeout(tick, 100);
        return;
      }
    } catch (error) { console.error('[upscale] Queue unavailable', error instanceof Error ? error.message : error); }
    if (!stopped) timer = setTimeout(tick, 3000);
  }
  timer = setTimeout(tick, 3000);
  nitroApp.hooks.hook('close', () => { stopped = true; clearTimeout(timer); });
});
