export function usePageSeo(title: string, description: string, pageImage = '') {
  const config = useRuntimeConfig(),
    route = useRoute(),
    base = config.public.siteUrl.replace(/\/$/, ''),
    url = base + route.path,
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
    ogUrl: url,
    ogSiteName: config.public.siteName,
    ogImage: image,
    twitterCard: 'summary_large_image',
    twitterTitle: title,
    twitterDescription: description,
    twitterImage: image,
  });
  useHead({
    link: [
      {
        rel: 'canonical',
        href: url,
      },
    ],
  });
}
