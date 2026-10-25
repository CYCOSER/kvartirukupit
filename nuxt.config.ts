export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  modules: ['@nuxtjs/tailwindcss'],
  css: ['@fontsource-variable/manrope', '~/assets/css/typography.css'],
  tailwindcss: { cssPath: '~/assets/css/main.css', viewer: false },
  // Serve fonts as same-origin files to satisfy CSP font-src 'self'.
  vite: { build: { assetsInlineLimit: 0 } },
  devtools: { enabled: false },
  runtimeConfig: {
    rf39Token: '',
    rf39SnapshotPath: '.data/rf39/snapshot.json',
    nmarketFeedUrl: '',
    nmarketSnapshotPath: '.data/nmarket/snapshot.xml',
    mapSearchUrl: 'https://nominatim.openstreetmap.org/search',
    public: {
      siteName: 'Квартирукупить',
      siteUrl: 'http://localhost:3100',
      phone: '',
      legalName: '',
      legalAddress: '',
      legalEmail: '',
      inn: '',
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'ru' },
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg?v=6' },
        { rel: 'preload', href: '/fonts/anticva-regular.otf', as: 'font', type: 'font/otf', crossorigin: 'anonymous' },
        { rel: 'preload', href: '/fonts/miama-nueva.otf', as: 'font', type: 'font/otf', crossorigin: 'anonymous' },
      ],
    },
  },
  routeRules: {
    '/morskoy-kabinet-7q4x/**': {
      headers: { 'X-Robots-Tag': 'noindex, nofollow' },
    },
  },
  nitro: {
    preset: 'node-server',
    externals: { external: ['@prisma/client', '@node-rs/argon2', 'sharp'] },
  },
});
