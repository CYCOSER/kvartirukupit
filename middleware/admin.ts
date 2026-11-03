export default defineNuxtRouteMiddleware(async () => {
  const request = useRequestFetch();
  const userId = useState<string | null>('admin-user-id', () => null);
  try {
    const user = await request<{ id: string }>('/api/admin/me');
    if (userId.value !== user.id) useImportJobs().reset();
    userId.value = user.id;
  } catch {
    userId.value = null;
    useImportJobs().reset();
    return navigateTo('/admin-console-9Xk6uiIs/login');
  }
});
