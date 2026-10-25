import type { RouterConfig } from '@nuxt/schema';
import { useNuxtApp } from '#app';
import { nextTick } from 'vue';
import { sectionPosition } from '~/utils/sectionPosition';

export default {
  async scrollBehavior(to, from, saved) {
    const nuxtApp = useNuxtApp();
    if (to.path !== from.path && from.matched.length) {
      await new Promise<void>((resolve) => {
        nuxtApp.hooks.hookOnce('page:loading:end', () => {
          requestAnimationFrame(() => resolve());
        });
      });
    }
    await nextTick();
    const catalogViewChanged = to.path === from.path
      && /^\/(catalog|elite)\/?$/.test(to.path)
      && to.hash === from.hash
      && to.query.view !== from.query.view;
    if (catalogViewChanged) {
      const filterKeys = new Set([...Object.keys(to.query), ...Object.keys(from.query)]);
      const sameFilters = [...filterKeys].every((key) => key === 'view' || key === 'page'
        || JSON.stringify(to.query[key]) === JSON.stringify(from.query[key]));
      // Changing presentation must not navigate back to the catalog section.
      if (sameFilters) return saved || false;
    }
    if (to.hash) return sectionPosition(to.hash) || saved || { top: 0 };
    return saved || { top: 0, left: 0, behavior: 'instant' };
  },
} satisfies RouterConfig;
