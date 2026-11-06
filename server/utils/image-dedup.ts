import { db } from './db';
import { propertyImageFingerprint, propertyPhotoFingerprint, samePhoto, type PhotoFingerprint } from './image-fingerprint';
import type { Prisma } from '@prisma/client';

type GalleryImage = { id: string; file: string; kind: string; order: number; crop?: Prisma.JsonValue; hueShift?: number };

export async function deduplicatePropertyImages(propertyId: string, apply = false) {
  const skipped = new Map<string, string>();
  async function fingerprint(image: Pick<GalleryImage, 'file' | 'kind' | 'crop' | 'hueShift'>, client: Pick<Prisma.TransactionClient, 'imageFingerprint'> = db) {
    try {
      const hash = await propertyImageFingerprint(image.file, undefined, client);
      const photo = image.kind === 'photo' && !image.crop && !image.hueShift ? await propertyPhotoFingerprint(image.file, client) : null;
      return { hash, photo };
    }
    catch (error) {
      if ((error as { statusCode?: number }).statusCode !== 400) throw error;
      skipped.set(image.file, `Не удалось проверить файл ${image.file}; изображение сохранено.`);
      return null;
    }
  }
  // Decode old galleries before locking rows; the locked pass normally reads cached hashes.
  for (const image of await db.propertyImage.findMany({ where: { propertyId }, select: { file: true, kind: true, crop: true, hueShift: true } }))
    await fingerprint(image);
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${propertyId}))`;
        // Row locks also protect against edits and upscale workers that do not take the upload lock.
        const gallery = await tx.$queryRaw<GalleryImage[]>`SELECT "id", "file", "kind", "order", "crop", "hueShift" FROM "PropertyImage"
          WHERE "propertyId" = ${propertyId} ORDER BY "order", "id" FOR UPDATE`;
        const unique: { hash: string; photo: PhotoFingerprint | null; image: GalleryImage; order: number }[] = [];
        const duplicates: string[] = [];
        for (const image of gallery) {
          const value = await fingerprint(image, tx);
          if (!value) continue;
          const previous = unique.find(entry => entry.hash === value.hash || samePhoto(entry.photo, value.photo));
          if (!previous) unique.push({ ...value, image, order: image.order });
          else if (previous.image.kind !== 'plan' && image.kind === 'plan') {
            duplicates.push(previous.image.id);
            previous.image = image;
            previous.photo = null;
          } else duplicates.push(image.id);
        }
        let deleted = 0;
        if (apply && duplicates.length) {
          deleted = (await tx.propertyImage.deleteMany({ where: { propertyId, id: { in: duplicates } } })).count;
          for (const { image, order } of unique) {
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
