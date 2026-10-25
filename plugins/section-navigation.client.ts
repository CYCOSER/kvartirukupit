import { sectionPosition } from '~/utils/sectionPosition';

export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter();
  function alignSection() {
    const hash = router.currentRoute.value.hash;
    if (!hash) return;
    const position = sectionPosition(hash);
    if (position)
      window.scrollTo({
        top:
          window.scrollY +
          position.el.getBoundingClientRect().top -
          position.top,
        behavior: 'instant',
      });
  }
  function afterLayout() {
    requestAnimationFrame(() => requestAnimationFrame(alignSection));
  }
  nuxtApp.hook('app:mounted', afterLayout);
  nuxtApp.hook('page:finish', afterLayout);
});
