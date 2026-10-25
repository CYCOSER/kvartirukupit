import { z } from 'zod';
import { createError } from 'h3';
import { rf39ReadBody } from './rf39';
import type { Rf39Object } from './rf39-data';

export function snapshotRf39Developments(items: Rf39Object[]) {
  const groups = new Map<number, { id: number; title: string; location: string; address: string; objectIds: number[] }>();
  for (const item of items) {
    const source = item.development;
    if (!source?.id) continue;
    const group = groups.get(source.id) || { id: source.id, title: '', location: '', address: '', objectIds: [] };
    group.title ||= source.title || '';
    group.location ||= item.city || '';
    group.objectIds.push(item.id);
    groups.set(source.id, group);
  }
  return [...groups.values()];
}

const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const development = z.object({
  id, title: z.string(), town: z.string().nullish(), address: z.string().nullish(),
  objects: z.union([z.array(z.object({ id })), z.record(z.object({ id }))]).nullish(),
});

export function parseRf39Developments(input: unknown) {
  const response = z.object({ code: z.literal(200), data: z.union([z.array(development), z.record(development)]) }).parse(input);
  const items = Object.values(response.data);
  if (items.length > 10000 || new Set(items.map(item => item.id)).size !== items.length) throw new Error('Invalid developments');
  return items.map(item => ({ id: item.id, title: item.title, location: item.town || '', address: item.address || '',
    objectIds: [...new Set(Object.values(item.objects || {}).map(object => object.id))] }));
}

export async function fetchRf39Developments(token: string, developmentId?: string) {
  if (!token) throw createError({ statusCode: 503, data: { message: 'Подключение CRM не настроено.' } });
  if (developmentId && (!/^[1-9]\d{0,15}$/.test(developmentId) || !Number.isSafeInteger(Number(developmentId))))
    throw createError({ statusCode: 400, data: { message: 'ID ЖК в CRM должен быть целым положительным числом.' } });
  try {
    const response = await fetch('https://crm.rf39.ru/api/developments', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
      body: new URLSearchParams({ token, ...(developmentId ? { id: developmentId } : { has_objects: '1' }) }),
    });
    return parseRf39Developments(JSON.parse((await rf39ReadBody(response, 32 * 1024 * 1024)).toString('utf8')));
  } catch {
    throw createError({ statusCode: 502, data: { message: 'Не удалось получить список ЖК из CRM. Повторите поиск.' } });
  }
}
