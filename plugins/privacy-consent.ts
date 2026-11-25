import { useAnalyticsConsent } from '~/composables/useAnalyticsConsent';

export default defineNuxtPlugin({
  name: 'privacy-consent',
  setup() {
    const { serverVersion, initializeConsent, checkConsent } = useAnalyticsConsent();
    const route = useRoute();

    // Consent flow applies to public pages, but never the admin console or the
    // policy page itself (it must stay readable without accepting first).
    const isPublicRoute = computed(
      () =>
        !route.path.startsWith('/admin-console-') && route.path !== '/privacy',
    );

    const { data } = useFetch('/api/privacy-policy', {
      key: 'privacy-policy-version',
      server: true,
      default: () => ({ version: '', effectiveAt: '' }),
    });

    watch(data, value => {
      serverVersion.value = value ?? null;
      if (import.meta.client && isPublicRoute.value) checkConsent();
    });

    if (import.meta.client) {
      initializeConsent();
      serverVersion.value = data.value ?? null;
      if (isPublicRoute.value) checkConsent();
    }
  },
});