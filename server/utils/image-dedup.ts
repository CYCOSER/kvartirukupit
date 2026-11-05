import { db } from './db';
import { propertyImageFingerprint } from './image-fingerprint';
import type { Prisma } from '@prisma/client';

type GalleryImage = { id: string; file: string; kind: string; order: number };

export async function deduplicatePropertyImages(propertyId: string, apply = false) {
  const skipped = new Map<string, string>();
  async function fingerprint(file: string, client: Pick<Prisma.TransactionClient, 'imageFingerprint'> = db) {
    try { return await propertyImageFingerprint(file, undefined, client); }
    catch (error) {
      if ((error as { statusCode?: number }).statusCode !== 400) throw error;
      skipped.set(file, `Не удалось проверить файл ${file}; изображение сохранено.`);
      return null;
    }
  }
  // Decode old galleries before locking rows; the locked pass normally reads cached hashes.
  for (const image of await db.propertyImage.findMany({ where: { propertyId }, select: { file: true } }))
    await fingerprint(image.file);
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${propertyId}))`;
        // Row locks also protect against edits and upscale workers that do not take the upload lock.
        const gallery = await tx.$queryRaw<GalleryImage[]>`SELECT "id", "file", "kind", "order" FROM "PropertyImage"
          WHERE "propertyId" = ${propertyId} ORDER BY "order", "id" FOR UPDATE`;
        const unique = new Map<string, { image: GalleryImage; order: number }>();
        const duplicates: string[] = [];
        for (const image of gallery) {
          const hash = await fingerprint(image.file, tx);
          if (!hash) continue;
          const previous = unique.get(hash);
          if (!previous) unique.set(hash, { image, order: image.order });
          else if (previous.image.kind !== 'plan' && image.kind === 'plan') {
            duplicates.push(previous.image.id);
            previous.image = image;
          } else duplicates.push(image.id);
        }
        let deleted = 0;
        if (apply && duplicates.length) {
          deleted = (await tx.propertyImage.deleteMany({ where: { propertyId, id: { in: duplicates } } })).count;
          for (const { image, order } of unique.values()) {
            if (image.order !== order) await tx.propertyImage.update({ where: { id: image.id }, data: { order } });
          }
        }
        return { scanned: gallery.length, duplicates: duplicates.length, deleted, warnings: [...skipped.values()] };
      }, { timeout: 30000 });
    } catch (error) {
      const failure = error as { code?: string; meta?: { code?: string } };
      if (attempt >= 2 || (failure.code !== 'P2034' && failure.meta?.code !== '40P01' && failure.meta?.code !== '40001')) throw error;
    }
  }
}
