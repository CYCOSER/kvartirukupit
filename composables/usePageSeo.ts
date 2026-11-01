export function usePageSeo(title: string, description: string, pageImage = '') {
  const config = useRuntimeConfig(),
    route = useRoute(),
    base = config.public.siteUrl.replace(/\/$/, ''),
    url = computed(() => {
      const path = route.path.replace(/\/+$/, '') || '/';
      const page = typeof route.query.page === 'string' ? Number(route.query.page) : 1;
      const paginated = (path === '/catalog' || path === '/elite')
        && route.query.view !== 'map'
        && Number.isInteger(page) && page > 1 && page <= 10000;
      return base + path + (paginated ? `?page=${page}` : '');
    }),
    image = pageImage
      ? pageImage.startsWith('http')
        ? pageImage
        : base + pageImage
      : base + '/images/backgrounds/home-hero.webp';
  useSeoMeta({
    title: `${title} — ${config.public.siteName}`,
    description,
    ogTitle: title,
    ogDescription: description,
    ogType: 'website',
    ogUrl: () => url.value,
    ogSiteName: config.public.siteName,
    ogImage: image,
    twitterCard: 'summary_large_image',
    twitterTitle: title,
    twitterDescription: description,
    twitterImage: image,
  });
  useHead(() => ({
    link: [
      {
        rel: 'canonical',
        href: url.value,
      },
    ],
  }));
}
