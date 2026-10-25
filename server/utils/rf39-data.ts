import { z } from 'zod';
import { apartmentTitle, formatReadiness, propertySchema } from '../../shared/property';

const idSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const paramsSchema = z.record(z.object({
  name: z.string().nullish(),
  value: z.union([z.string(), z.number(), z.boolean()]).nullish(),
})).nullish();
const layoutSchema = z.object({
  id: idSchema,
  title: z.string().nullish(),
  description: z.string().nullish(),
  apartment: z.string().nullish(),
  price: z.union([z.number(), z.string()]).nullish(),
  images: z.array(z.string()).nullish(),
  params: paramsSchema,
});
const objectSchema = z.object({
  id: idSchema,
  title: z.string().nullish(),
  type: z.string(),
  deal_type: z.string(),
  description: z.string().nullish(),
  address: z.string().nullish(),
  apartment: z.string().nullish(),
  city: z.string().nullish(),
  district: z.string().nullish(),
  coordinates: z.union([z.array(z.union([z.number(), z.string()])), z.string()]).nullish(),
  price: z.union([z.number(), z.string()]).nullish(),
  images: z.array(z.string()).nullish(),
  params: paramsSchema,
  layouts: z.union([z.record(layoutSchema), z.array(layoutSchema)]).nullish(),
  development: z.object({
    id: idSchema.nullish(),
    title: z.string().nullish(),
    developer: z.object({ title: z.string().nullish() }).nullish(),
  }).nullish(),
  complex: z.object({ id: idSchema, title: z.string().nullish() }).nullish(),
});
export type Rf39Object = z.infer<typeof objectSchema>;

export function parseRf39Response(input: unknown): Rf39Object[] {
  const response = z.object({
    code: z.literal(200),
    data: z.union([z.record(objectSchema), z.array(objectSchema)]),
  }).parse(input);
  const items = Object.values(response.data);
  if (items.length > 100 || new Set(items.map(item => item.id)).size !== items.length)
    throw new Error('Некорректная страница объектов CRM.');
  return items;
}

export function rf39Supported(item: Rf39Object) {
  return item.deal_type === 'sale' &&
    ['Квартиры в новостройках', 'Квартиры - вторичное жильё'].includes(item.type);
}

export function rf39Number(value: unknown): number | null {
  if (value == null || value === '') return null;
  const text = String(value).trim().replace(/[\s\u00a0]/g, '').replace(',', '.');
  const match = text.match(/^(-?\d+(?:\.\d+)?)(?:м²|м2|м\.|м|₽|руб\.?|сот\.?)?$/i);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function rf39IsComplex(item: Rf39Object) {
  if (Object.keys(item.layouts || {}).length) return true;
  if (item.type !== 'Квартиры в новостройках' || !item.complex?.id || item.apartment?.trim() ||
      rf39Number(item.params?.area?.value) !== null || rf39Number(item.params?.rooms?.value) !== null) return false;
  const title = item.title?.trim() || '';
  return /^(?:жк|жилой\s+комплекс|корпус|дом|строение)(?:\s|[«"“№#])/iu.test(title) &&
    !/квартир|студи|апартамент/iu.test(title);
}

export function rf39Summary(item: Rf39Object) {
  const isComplex = rf39IsComplex(item);
  return {
    id: item.id,
    title: item.title?.trim() || `Объект CRM №${item.id}`,
    category: item.type,
    location: item.city || '',
    address: item.address || '',
    price: rf39Number(item.price),
    area: isComplex ? null : rf39Number(item.params?.area?.value),
    bedrooms: isComplex ? null : rf39Number(item.params?.rooms?.value),
    floors: rf39Number(item.params?.['floors-total']?.value),
    developer: item.development?.developer?.title || null,
    layoutCount: Object.keys(item.layouts || {}).length,
    supported: rf39Supported(item),
  };
}

// RF39 also returns server filesystem paths instead of public image URLs.
export function rf39ImageUrl(value: string): string | null {
  const path = value.replace(/^\/var\/www\/jokercrm\/web(?=\/images\/)/, '');
  try {
    const url = new URL(path, 'https://crm.rf39.ru');
    if (url.origin !== 'https://crm.rf39.ru' || url.username || url.password ||
        url.search || url.hash || !/^\/images\/objects\/[a-zA-Z0-9/_-]+\.(?:jpe?g|png|webp)$/i.test(url.pathname))
      return null;
    return url.href;
  } catch { return null; }
}

export function rf39Draft(item: Rf39Object, type: 'complex' | 'apartment' = rf39IsComplex(item) ? 'complex' : 'apartment') {
  if (!rf39Supported(item)) throw new Error('Сайт поддерживает только продажу квартир и корпусов ЖК.');
  const param = (key: string) => item.params?.[key]?.value;
  const layoutCount = Object.keys(item.layouts || {}).length;
  const parts = Array.isArray(item.coordinates) ? item.coordinates : item.coordinates?.trim().split(/\s+/);
  const coords = parts?.length === 2 ? parts.map(Number) : [];
  const validCoords = coords.length === 2 && parts!.every(part => String(part).trim() !== '') && coords.every(Number.isFinite) &&
    Math.abs(coords[0]!) <= 90 && Math.abs(coords[1]!) <= 180;
  const year = String(param('built-year') || '').match(/\b(19|20)\d{2}\b/)?.[0];
  const quarter = String(param('ready-quarter') || '').match(/^[1-4]$/)?.[0];
  const stage = String(param('building-state') || '').trim();
  const readiness = formatReadiness(year ? `${quarter ? quarter + ' кв. ' : ''}${year}` : 'Уточняется');
  const warnings: string[] = [];
  const number = (value: unknown, max: number, integer = false) => {
    const parsed = rf39Number(value);
    return parsed !== null && parsed <= max && (!integer || Number.isInteger(parsed)) ? parsed : null;
  };
  const price = number(item.price, 2000000000, true);
  if (price === null || price === 0) warnings.push('Цена не указана или требует проверки.');
  if (!validCoords && item.coordinates) warnings.push('Координаты CRM не распознаны.');
  const description = (item.description || '').replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div)>/gi, '\n\n').replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
  if (type === 'complex' && layoutCount) warnings.push(`Импортирован корпус/ЖК. ${layoutCount} планировок остаются в CRM; отдельные квартиры не создавались.`);
  const area = type === 'apartment' ? number(param('area'), 10000) || null : null;
  const bedrooms = type === 'apartment' ? number(param('rooms'), 100, true) : null;
  const data = propertySchema.parse({
    title: type === 'apartment' ? apartmentTitle(bedrooms, area) : item.title?.trim() || `Объект CRM №${item.id}`,
    slug: `rf39-${item.id}`, type,
    location: item.city?.trim() || 'Уточняется', address: item.address || '',
    latitude: validCoords ? coords[0] : null, longitude: validCoords ? coords[1] : null,
    price: price || null, status: 'available',
    area, bedrooms,
    floors: number(param('floors-total'), 100, true) || null,
    landArea: null, seaDistance: null, readiness,
    finish: String(param('renovation') || param('decoration') || 'Уточняется'),
    description, utilities: [], published: false, featured: false, elite: false, demo: false,
  });
  const imageUrls = [...new Set((item.images || []).map(rf39ImageUrl).filter((url): url is string => !!url))];
  if (imageUrls.length !== (item.images || []).length) warnings.push('Некоторые адреса фотографий отклонены или повторяются.');
  if (imageUrls.length > 100) warnings.push('В галерею можно перенести только первые 100 фотографий.');
  return {
    data: { ...data, sourceId: `rf39:${item.id}`, sourceName: 'CRM RF39', sourceMode: 'rf39-copy',
      sourceUrl: 'https://crm.rf39.ru', sourceFetchedAt: new Date(),
      developer: item.development?.developer?.title || null, district: item.district || null,
      constructionStatus: stage || null, priceKind: null,
      rf39ComplexId: item.development?.id ? String(item.development.id) : null,
      rf39BuildingId: item.complex?.id ? String(item.complex.id) : null,
    },
    imageUrls: imageUrls.slice(0, 100), planImageUrls: [] as string[], warnings,
  };
}

export function rf39LayoutDraft(parent: Rf39Object, layoutId: number) {
  const id = idSchema.parse(layoutId);
  const layout = Object.values(parent.layouts || {}).find(item => item.id === id);
  if (!rf39Supported(parent) || !rf39IsComplex(parent) || !layout)
    throw new Error('Планировка не найдена в выбранном корпусе CRM.');
  const params = { ...parent.params, ...layout.params };
  for (const key of ['area', 'rooms', 'floor']) if (!layout.params?.[key]) delete params[key];
  const draft = rf39Draft({
    ...parent, layouts: null,
    apartment: layout.apartment, description: layout.description, price: layout.price,
    images: layout.images, params,
  }, 'apartment');
  draft.data.sourceId = `rf39-layout:${parent.id}:${id}`;
  draft.data.slug = `rf39-layout-${parent.id}-${id}`;
  return draft;
}
