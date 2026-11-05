import { z } from 'zod';

export const DEFAULT_RF39_FEED_URL = 'https://feed.rf39.ru/30.xml';
export const feedSyncInputSchema = z.object({
  url: z.string().trim().max(300).regex(/^https:\/\/feed\.rf39\.ru\/\d+\.xml$/,
    'Укажите HTTPS-ссылку вида https://feed.rf39.ru/30.xml.').default(DEFAULT_RF39_FEED_URL),
  enabled: z.boolean().default(false),
  intervalMinutes: z.number().int().min(15).max(10080).default(60),
}).strict();
export const feedSyncRunSchema = z.object({ requestId: z.string().uuid() }).strict();
export type FeedSyncInput = z.infer<typeof feedSyncInputSchema>;
export type FeedSyncSettings = FeedSyncInput & {
  nextRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastJobId: string | null;
  activeJobId: string | null;
};
