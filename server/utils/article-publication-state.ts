export function articlePublicationState(
  publish: boolean,
  requestedAt: Date | null,
  fallbackAt: Date | null = null,
  now = new Date(),
) {
  if (!publish) return { published: false, publishedAt: null };
  const publishedAt = requestedAt ?? fallbackAt ?? now;
  return { published: publishedAt <= now, publishedAt };
}
