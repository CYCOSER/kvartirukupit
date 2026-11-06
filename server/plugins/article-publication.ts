import { db } from '../utils/db';
import { scheduleArticlePublication } from '../utils/article-publication';

export default defineNitroPlugin(async () => {
  const now = new Date();
  await db.article.updateMany({
    where: { published: false, publishedAt: { lte: now } },
    data: { published: true },
  });
  const scheduled = await db.article.findMany({
    where: { published: false, publishedAt: { gt: now } },
    select: { id: true, publishedAt: true },
  });
  for (const article of scheduled)
    scheduleArticlePublication(article.id, article.publishedAt);
});
