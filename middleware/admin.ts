export default defineNuxtRouteMiddleware(async () => {
  const request = useRequestFetch();
  try {
    await request('/api/admin/me');
  } catch {
    return navigateTo('/admin-console-9Xk6uiIs/login');
  }
});
