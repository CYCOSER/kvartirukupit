export default defineNuxtRouteMiddleware(async () => {
  const request = useRequestFetch();
  try {
    await request('/api/admin/me');
  } catch {
    return navigateTo('/morskoy-kabinet-7q4x/login');
  }
});
