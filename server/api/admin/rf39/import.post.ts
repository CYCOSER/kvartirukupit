import { z } from 'zod';
import { fetchRf39Objects } from '../../../utils/rf39';
import { rf39Draft, rf39LayoutDraft } from '../../../utils/rf39-data';
import { existingImportedProperty, importProperty } from '../../../utils/import-property';
import { preferredNmarketApartment, rf39ApartmentIdentity } from '../../../utils/apartment-matching';
import { importNmarketProperty, prepareNmarketImport } from '../../../utils/import-nmarket';

export default defineEventHandler(async (event) => {
  const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
  const body = z.object({ id, layoutId: id.optional(), complexId: z.string().trim().min(1).max(100).optional(),
    preferredNmarketId: z.string().regex(/^apartment:\d{1,20}$/).optional(), nmarketSnapshot: z.literal('saved').optional(),
    preferredSource: z.enum(['nmarket', 'rf39']).default('nmarket') }).strict().safeParse(await readBody(event));
  if (!body.success) throw createError({ statusCode: 400, data: { message: 'Выберите объект CRM.' } });
  const sourceId = body.data.layoutId ? `rf39-layout:${body.data.id}:${body.data.layoutId}` : `rf39:${body.data.id}`;
  const existing = await existingImportedProperty(sourceId, body.data.complexId);
  if (existing) return existing;
  const config = useRuntimeConfig(event);
  const items = await fetchRf39Objects(config.rf39Token, 0, body.data.id);
  const item = items.find(item => item.id === body.data.id);
  if (!item) throw createError({ statusCode: 404, data: { message: 'Объект больше не доступен среди опубликованных объектов CRM.' } });
  const saved = body.data.nmarketSnapshot === 'saved';
  const preferred = body.data.complexId ? preferredNmarketApartment(body.data.complexId, sourceId, saved) : undefined;
  if (body.data.preferredNmarketId && preferred?.id !== body.data.preferredNmarketId)
    throw createError({ statusCode: 409, data: { message: 'Результат сопоставления устарел. Повторите поиск квартир в ЖК.' } });
  if (preferred) {
    if (JSON.stringify(preferred.identity) !== JSON.stringify(rf39ApartmentIdentity(item, body.data.layoutId)))
      throw createError({ statusCode: 409, data: { message: 'Данные CRM изменились. Повторите поиск квартир в ЖК.' } });
    if (body.data.preferredSource === 'nmarket')
      return importNmarketProperty(config, preferred.id, body.data.complexId, saved,
        { sourceId, apartmentKey: preferred.key, identity: preferred.identity });
  }
  let draft;
  try { draft = body.data.layoutId ? rf39LayoutDraft(item, body.data.layoutId) : rf39Draft(item); }
  catch { throw createError({ statusCode: 422, data: { message: 'Данные объекта не подходят для карточки ЖК или квартиры. Объект не импортирован.' } }); }
  if (preferred) {
    // Revalidate the duplicate before saving either source's aliases.
    const { sources } = await prepareNmarketImport(config, preferred.id, body.data.complexId, saved,
      { sourceId, apartmentKey: preferred.key, identity: preferred.identity });
    draft.warnings.push('Квартира также найдена в Нмаркете. Создана одна карточка с данными CRM RF39.');
    return importProperty(draft, body.data.complexId, true, sources.reverse());
  }
  return importProperty(draft, body.data.complexId, true);
});
