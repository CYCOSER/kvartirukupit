import { createError } from 'h3';
import type { Prisma } from '@prisma/client';
import { propertyImageFingerprint } from './image-fingerprint';

type GalleryImage = { file: string; originalFile?: string | null; kind?: string; planRole?: string | null; order: number };

export async function missingApartmentFloorPlans<T extends GalleryImage>(existing: GalleryImage[], incoming: T[],
  client: Pick<Prisma.TransactionClient, 'imageFingerprint'>): Promise<{ images: T[]; warnings: string[] }> {
  const plans = existing.filter(image => image.kind === 'plan');
  const files = new Set(plans.map(image => image.originalFile || image.file));
  const floors = incoming.filter(image => image.kind === 'plan' && image.planRole === 'floor' && !files.has(image.originalFile || image.file));
  if (!floors.length) return { images: [], warnings: [] };
  const hashes = new Set<string>(), warnings: string[] = [];
  for (const image of plans) {
    const file = image.originalFile || image.file;
    try { hashes.add(await propertyImageFingerprint(file, undefined, client)); }
    catch (error) {
      if ((error as { statusCode?: number }).statusCode !== 400) throw error;
      warnings.push(`Не удалось сравнить сохранённый план №${image.order + 1}: файл недоступен. Существующее изображение сохранено; новые планы проверены по доступным файлам.`);
    }
  }
  const added: T[] = [];
  let order = Math.max(-1, ...existing.map(image => image.order)) + 1;
  for (const image of floors) {
    const file = image.originalFile || image.file;
    if (files.has(file)) continue;
    const hash = await propertyImageFingerprint(file, undefined, client);
    if (hashes.has(hash)) continue;
    hashes.add(hash);
    files.add(file);
    added.push({ ...image, order: order++ });
  }
  if (existing.length + added.length > 100) throw createError({ statusCode: 409,
    data: { message: 'В общей карточке больше 100 изображений. Объединение пропущено, чтобы не потерять планы этажей.' } });
  return { images: added, warnings };
}
