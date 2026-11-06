import { schedule, type ScheduledTask } from 'node-cron';
import { db } from './db';

const tasks = new Map<string, ScheduledTask>();

export function scheduleArticlePublication(
  id: string,
  publishedAt: Date | null,
  runAt = publishedAt,
) {
  tasks.get(id)?.destroy();
  tasks.delete(id);
  if (!publishedAt || !runAt) return;

  const scheduledAt = publishedAt;
  const startAt =
    runAt.getTime() <= Date.now() ? new Date(Date.now() + 1000) : runAt;
  const expression = [
    startAt.getUTCSeconds(),
    startAt.getUTCMinutes(),
    startAt.getUTCHours(),
    startAt.getUTCDate(),
    startAt.getUTCMonth() + 1,
    '*',
  ].join(' ');

  let task: ScheduledTask;
  task = schedule(
    expression,
    async () => {
      if (tasks.get(id) === task) tasks.delete(id);
      if (Date.now() < scheduledAt.getTime()) {
        scheduleArticlePublication(
          id,
          scheduledAt,
          new Date(scheduledAt.getTime() + 1000),
        );
        return;
      }
      try {
        await db.article.updateMany({
          where: {
            id,
            published: false,
            publishedAt: { equals: scheduledAt, lte: new Date() },
          },
          data: { published: true },
        });
      } catch (error) {
        console.error(`Failed to publish scheduled article ${id}`, error);
        scheduleArticlePublication(
          id,
          scheduledAt,
          new Date(Date.now() + 60_000),
        );
      }
    },
    { timezone: 'UTC', maxExecutions: 1, name: `article-${id}` },
  );
  tasks.set(id, task);
}
