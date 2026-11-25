import { useAnalyticsConsent } from '~/composables/useAnalyticsConsent';

export default defineNuxtPlugin({
  name: 'privacy-consent',
  setup() {
    const { serverVersion, initializeConsent, checkConsent } = useAnalyticsConsent();
    const route = useRoute();

    // Consent flow applies only to public pages, never the admin console.
    const isPublicRoute = computed(() => !route.path.startsWith('/admin-console-'));

    const { data } = useFetch('/api/privacy-policy', {
      key: 'privacy-policy-version',
      server: true,
      default: () => ({ version: '', effectiveAt: '' }),
    });

    watch(data, value => {
      serverVersion.value = value ?? null;
      if (isPublicRoute.value) checkConsent();
    });

    if (import.meta.client) {
      initializeConsent();
      serverVersion.value = data.value ?? null;
      if (isPublicRoute.value) checkConsent();
    }
  },
});