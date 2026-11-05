import type { Prisma } from '@prisma/client';

export type ImportConfig = { rf39FeedUrl?: string; rf39SnapshotPath: string; nmarketFeedUrl: string; nmarketSnapshotPath: string };
export type ImportResult = { id: string; created: boolean; linked: boolean; warnings: string[] };
export type ImportExecution = {
  guard(tx: Prisma.TransactionClient): Promise<void>;
  complete?(tx: Prisma.TransactionClient, result: unknown): Promise<void>;
};
export class ImportOwnershipLost extends Error {
  constructor() { super('Import job ownership lost'); }
}
export function importInfrastructureError(error: unknown) {
  return error instanceof ImportOwnershipLost || /^P\d{4}$/.test(String((error as { code?: string })?.code || ''))
    || /^PrismaClient/.test(String((error as { name?: string })?.name || ''));
}
