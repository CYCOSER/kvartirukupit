export default defineEventHandler((event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const token = useRuntimeConfig(event).agentApiToken;
  const enabled = typeof token === 'string' && /^[\x21-\x7e]{32,}$/.test(token);
  return {
    enabled,
    token: enabled && getQuery(event).reveal === '1' ? token : null,
  };
});
