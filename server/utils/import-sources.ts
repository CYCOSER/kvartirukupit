import { createError } from 'h3';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { lockPropertyRelations } from './property-relations';

export type ImportSource = { sourceId: string; apartmentKey?: string | null };
const select = { id: true, type: true, complexId: true, sourceId: true } as const;
const conflict = () => createError({ statusCode: 409, data: { message: 'Найдены разные существующие карточки одной квартиры. Автоматическое объединение остановлено; проверьте объекты вручную.' } });

export async function findImportSourceProperty(tx: Prisma.TransactionClient, sources: ImportSource[]) {
  const ids = sources.map(source => source.sourceId);
  const ownAliases = await tx.propertyImportSource.findMany({ where: { sourceId: { in: ids } } });
  const keys = [...new Set([...sources.map(source => source.apartmentKey), ...ownAliases.map(source => source.apartmentKey)].filter((key): key is string => !!key))];
  const properties = await tx.property.findMany({ where: { sourceId: { in: ids } }, select });
  const aliases = await tx.propertyImportSource.findMany({ where: { OR: [{ sourceId: { in: ids } }, ...(keys.length ? [{ apartmentKey: { in: keys } }] : [])] }, include: { property: { select } } });
  const matches = new Map([...properties, ...aliases.map(alias => alias.property)].map(property => [property.id, property]));
  if (matches.size > 1) throw conflict();
  return matches.values().next().value || null;
}

export async function saveImportSources(tx: Prisma.TransactionClient, propertyId: string, sources: ImportSource[]) {
  for (const source of sources) {
    const existing = await tx.propertyImportSource.findUnique({ where: { sourceId: source.sourceId } });
    if (existing && (existing.propertyId !== propertyId || existing.apartmentKey && source.apartmentKey && existing.apartmentKey !== source.apartmentKey)) throw conflict();
    await tx.propertyImportSource.upsert({ where: { sourceId: source.sourceId },
      create: { ...source, propertyId }, update: source.apartmentKey ? { apartmentKey: source.apartmentKey } : {} });
  }
}

// Discover old imported copies before either source starts creating drafts.
export async function rememberExistingImportSources(sources: ImportSource[]) {
  if (!sources.length) return;
  await db.$transaction(async tx => {
    await lockPropertyRelations(tx);
    const ids = sources.map(source => source.sourceId);
    const properties = await tx.property.findMany({ where: { sourceId: { in: ids } }, select: { id: true, sourceId: true } });
    const aliases = await tx.propertyImportSource.findMany({ where: { sourceId: { in: ids } } });
    for (const source of sources) {
      const property = properties.find(property => property.sourceId === source.sourceId);
      const alias = aliases.find(alias => alias.sourceId === source.sourceId);
      if (property || alias) await saveImportSources(tx, property?.id || alias!.propertyId, [source]);
    }
  }, { timeout: 30000 });
}
