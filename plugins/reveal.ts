import type { ObjectDirective } from 'vue';

export default defineNuxtPlugin(nuxtApp => {
  const cleanups = new WeakMap<HTMLElement, () => void>();
  const directive: ObjectDirective<HTMLElement, number | undefined> = {
    getSSRProps: () => ({}),
    mounted(element, binding) {
      const preference = matchMedia('(prefers-reduced-motion: reduce)');
      if (preference.matches || !('IntersectionObserver' in window) || !element.animate) return;
      let animation: Animation | undefined;
      const cleanup = () => {
        observer.disconnect();
        animation?.cancel();
        preference.removeEventListener('change', cleanup);
        element.removeEventListener('focusin', cleanup);
        element.removeEventListener('pointerdown', cleanup);
        cleanups.delete(element);
      };
      const observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer.disconnect();
        if (element.contains(document.activeElement)) { cleanup(); return; }
        animation = element.animate(
          // Keep already-painted SSR images opaque throughout the entrance.
          [{ transform: 'translateY(14px)' }, { transform: 'translateY(0)' }],
          { duration: 620, delay: binding.value ?? 0, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' },
        );
        animation.onfinish = cleanup;
      }, { threshold: .1 });
      // Visible without JS; each element enters once, interaction cancels movement.
      preference.addEventListener('change', cleanup);
      element.addEventListener('focusin', cleanup);
      element.addEventListener('pointerdown', cleanup);
      cleanups.set(element, cleanup);
      observer.observe(element);
    },
    beforeUnmount(element) { cleanups.get(element)?.(); },
  };
  nuxtApp.vueApp.directive('reveal', directive);
});
