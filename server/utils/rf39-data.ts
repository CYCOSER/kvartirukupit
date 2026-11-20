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
  external_description: z.string().nullish(),
  apartment: z.string().nullish(),
  price: z.union([z.number(), z.string()]).nullish(),
  images: z.array(z.string()).nullish(),
  imagesIncomplete: z.boolean().optional(),
  params: paramsSchema,
  yandexBuildingId: z.string().max(100).nullish(),
  yandexHouseId: z.string().max(100).nullish(),
  buildingName: z.string().max(300).nullish(),
  complexDescription: z.string().nullish(),
});
export const rf39ObjectSchema = z.object({
  id: idSchema,
  title: z.string().nullish(),
  type: z.string(),
  deal_type: z.string(),
  description: z.string().nullish(),
  external_description: z.string().nullish(),
  stickers: z.array(z.union([idSchema, z.object({ id: idSchema })])).nullish(),
  object_stickers: z.array(z.object({ sticker_id: idSchema })).nullish(),
  address: z.string().nullish(),
  apartment: z.string().nullish(),
  city: z.string().nullish(),
  district: z.string().nullish(),
  coordinates: z.union([z.array(z.union([z.number(), z.string()])), z.string()]).nullish(),
  price: z.union([z.number(), z.string()]).nullish(),
  images: z.array(z.string()).nullish(),
  imagesIncomplete: z.boolean().optional(),
  params: paramsSchema,
  layouts: z.union([z.record(layoutSchema), z.array(layoutSchema)]).nullish(),
  development: z.object({
    id: idSchema.nullish(),
    title: z.string().nullish(),
    developer: z.object({ title: z.string().nullish() }).nullish(),
  }).nullish(),
  complex: z.object({ id: idSchema, title: z.string().nullish() }).nullish(),
  yandexBuildingId: z.string().max(100).nullish(),
  yandexHouseId: z.string().max(100).nullish(),
  complexDescription: z.string().nullish(),
});
export type Rf39Object = z.infer<typeof rf39ObjectSchema>;
type Rf39Layout = z.infer<typeof layoutSchema>;
export type Rf39CatalogEntry = {
  id: string;
  sourceId: string;
  objectId: number;
  layoutId?: number;
  type: 'complex' | 'apartment';
  complexSourceId?: string;
  complexTitle?: string;
  legacySourceId?: string;
  item: Rf39Object;
  summary: Omit<ReturnType<typeof rf39Summary>, 'id'> & { id: string | number };
};

export function parseRf39Response(input: unknown): Rf39Object[] {
  const response = z.object({
    code: z.literal(200),
    data: z.union([z.record(rf39ObjectSchema), z.array(rf39ObjectSchema)]),
  }).parse(input);
  const items = Object.values(response.data);
  if (items.length > 100 || new Set(items.map(item => item.id)).size !== items.length)
    throw new Error('Некорректная страница объектов CRM.');
  return items;
}

export function rf39Supported(item: Rf39Object) {
  return item.deal_type === 'sale' &&
    (['Квартиры в новостройках', 'Квартиры - вторичное жильё'].includes(item.type) || isComplexType(item.type));
}

function isComplexType(value: string) {
  return /^(?:жк|жилой\s+комплекс|новостройка)(?:\s|$|[«"“№#])/iu.test(value.trim());
}

export function rf39HasSticker(item: Rf39Object, stickerId: number) {
  return !!item.stickers?.some(sticker => (typeof sticker === 'number' ? sticker : sticker.id) === stickerId) ||
    !!item.object_stickers?.some(sticker => sticker.sticker_id === stickerId);
}

export function rf39Description(item: Pick<Rf39Object, 'description' | 'external_description'>, missingPolicy: 'main' | 'draft' = 'main') {
  const clean = (value: string | null | undefined) => (value || '').replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div)>/gi, '\n\n').replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ').replace(/&amp;/g, '&').trim();
  const external = clean(item.external_description);
  const description = external || (missingPolicy === 'main' ? clean(item.description) : '');
  return { description, requiresDraft: !description };
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
  if (isComplexType(item.type)) return true;
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

function buildingKey(item: Rf39Object, layout?: { yandexBuildingId?: string | null; yandexHouseId?: string | null }) {
  const buildingId = layout?.yandexBuildingId || item.yandexBuildingId;
  const houseId = layout?.yandexHouseId || item.yandexHouseId;
  const id = buildingId || houseId;
  if (!id || !/^[a-zA-Z0-9_-]{1,60}$/.test(id)) return null;
  return `${buildingId ? 'building' : 'house'}:${id}`;
}

export function rf39CatalogItems(items: Rf39Object[]): Rf39CatalogEntry[] {
  type Offer = { item: Rf39Object; layoutId?: number; layout?: Rf39Layout; sourceId: string };
  const offers: Offer[] = [];
  const explicitComplexes: Offer[] = [];
  for (const item of items) {
    const layouts = Object.values(item.layouts || {});
    if (layouts.length) {
      for (const layout of layouts) offers.push({ item, layoutId: layout.id, layout, sourceId: `rf39-layout:${item.id}:${layout.id}` });
      continue;
    }
    offers.push({ item, sourceId: `rf39:${item.id}` });
  }

  const groups = new Map<string, Offer[]>();
  const ungrouped: Offer[] = [];
  const layoutGroupsByParent = new Map<number, Set<string>>();
  for (const offer of offers) {
    const key = buildingKey(offer.item, offer.layout);
    if (rf39IsComplex(offer.item) && offer.layoutId === undefined) {
      if (key && rf39Supported(offer.item)) groups.set(key, [...(groups.get(key) || []), offer]);
      else explicitComplexes.push(offer);
      continue;
    }
    if (!key || !rf39Supported(offer.item)) { ungrouped.push(offer); continue; }
    groups.set(key, [...(groups.get(key) || []), offer]);
    if (offer.layoutId !== undefined) {
      if (!layoutGroupsByParent.has(offer.item.id)) layoutGroupsByParent.set(offer.item.id, new Set());
      layoutGroupsByParent.get(offer.item.id)!.add(key);
    }
  }

  const result: Rf39CatalogEntry[] = [];
  for (const [key, group] of groups) {
    const sourceId = `rf39:complex:yandex-${key}`;
    const representative = group.find(offer => rf39IsComplex(offer.item) && offer.layoutId === undefined)?.item ||
      group.find(offer => offer.layoutId !== undefined)?.item || group[0]!.item;
    const buildingName = group.map(offer => offer.layout?.buildingName || offer.item.development?.title).find(Boolean)?.trim();
    const addresses = new Set(group.map(offer => offer.item.address?.trim()).filter(Boolean));
    const locations = new Set(group.map(offer => offer.item.city?.trim()).filter(Boolean));
    const prices = group.map(offer => rf39Number(offer.layout?.price ?? offer.item.price));
    const floors = group.map(offer => rf39Number(offer.layout?.params?.['floors-total']?.value ?? offer.item.params?.['floors-total']?.value));
    const dates = group.map(offer => {
      const year = String(offer.layout?.params?.['built-year']?.value ?? offer.item.params?.['built-year']?.value ?? '').match(/\b(?:19|20)\d{2}\b/)?.[0];
      const quarter = String(offer.layout?.params?.['ready-quarter']?.value ?? offer.item.params?.['ready-quarter']?.value ?? '').match(/^[1-4]$/)?.[0];
      return year && quarter ? new Date(Date.UTC(Number(year), Number(quarter) * 3, 0)).toISOString().slice(0, 10) : null;
    }).filter((value): value is string => !!value);
    const images = [...new Set(group.flatMap(offer => offer.layout?.images || offer.item.images || [])
      .filter(url => !url.includes('/images/objects/layouts/')))].slice(0, 100);
    const complex: Rf39Object = {
      ...representative,
      title: buildingName || `ЖК ${key.split(':').at(-1)}`,
      type: 'Жилой комплекс',
      description: representative.complexDescription || '',
      external_description: representative.complexDescription || '',
      address: addresses.size === 1 ? [...addresses][0]! : '',
      city: locations.size === 1 ? [...locations][0]! : representative.city,
      price: prices.every(price => price !== null) ? String(Math.min(...prices as number[])) : null,
      images,
      imagesIncomplete: group.some(offer => offer.layout?.imagesIncomplete || offer.item.imagesIncomplete),
      params: {
        ...representative.params,
        area: { value: null },
        rooms: { value: null },
        'floors-total': { value: floors.every(floor => floor !== null) && floors.length ? Math.max(...floors as number[]) : null },
        'built-year': { value: dates.length ? Math.max(...dates.map(date => Number(date.slice(0, 4))) ) : null },
      },
      layouts: null,
      development: { ...(representative.development || {}), title: buildingName || representative.development?.title || null },
    };
    const complexEntry: Rf39CatalogEntry = {
      id: sourceId, sourceId, objectId: representative.id, type: 'complex', item: complex,
      ...(group.every(offer => offer.layoutId !== undefined && offer.item.id === representative.id) &&
          layoutGroupsByParent.get(representative.id)?.size === 1
        ? { legacySourceId: `rf39:${representative.id}` } : {}),
      summary: { ...rf39Summary(complex), id: sourceId, category: 'Жилые комплексы' },
    };
    result.push(complexEntry);
    for (const offer of group) {
      if (!rf39Supported(offer.item) || rf39IsComplex(offer.item) && offer.layoutId === undefined) continue;
      const apartment = offer.layoutId === undefined ? offer.item : {
        ...offer.item,
        apartment: offer.layout?.apartment || null,
        price: offer.layout?.price ?? null,
        images: offer.layout?.images || [],
        imagesIncomplete: offer.layout?.imagesIncomplete,
        params: offer.layout?.params || {},
        layouts: null,
      };
      const summary = rf39Summary(apartment);
      result.push({ id: offer.sourceId, sourceId: offer.sourceId, objectId: offer.item.id, layoutId: offer.layoutId,
        type: 'apartment', complexSourceId: sourceId, complexTitle: complex.title || undefined, item: offer.item,
        summary: { ...summary, id: offer.sourceId } });
    }
  }
  for (const offer of ungrouped) {
    const type = offer.layoutId !== undefined ? 'apartment' : rf39IsComplex(offer.item) ? 'complex' : 'apartment';
    const summary = offer.layoutId !== undefined ? rf39Summary({
      ...offer.item, apartment: offer.layout?.apartment || null, price: offer.layout?.price ?? null,
      images: offer.layout?.images || [], params: offer.layout?.params || {}, layouts: null,
    }) : rf39Summary(offer.item);
    result.push({ id: offer.sourceId, sourceId: offer.sourceId, objectId: offer.item.id, layoutId: offer.layoutId,
      type, item: offer.item, summary: { ...summary, id: offer.sourceId,
        ...(type === 'complex' ? { category: 'Жилые комплексы' } : {}) } });
  }
  for (const offer of explicitComplexes) {
    const summary = rf39Summary(offer.item);
    result.push({ id: offer.sourceId, sourceId: offer.sourceId, objectId: offer.item.id,
      type: 'complex', item: offer.item, summary: { ...summary, id: offer.sourceId, category: 'Жилые комплексы' } });
  }
  return result;
}

export function rf39CatalogDraft(entry: Rf39CatalogEntry, missingPolicy: 'main' | 'draft' = 'main') {
  const draft = entry.type === 'complex' ? rf39Draft({ ...entry.item, layouts: null }, 'complex', missingPolicy)
    : entry.layoutId === undefined ? rf39Draft(entry.item, 'apartment', missingPolicy)
      : rf39LayoutDraft(entry.item, entry.layoutId);
  draft.data.sourceId = entry.sourceId;
  draft.data.slug = `robj-${entry.sourceId.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 115)}`;
  if (entry.type === 'complex') {
    draft.data.developer = entry.item.development?.developer?.title || null;
    draft.data.published = false;
    draft.data.elite = false;
  }
  return draft;
}

// RF39 also returns server filesystem paths instead of public image URLs.
export function rf39ImageUrl(value: string): string | null {
  const path = value.replace(/^\/var\/www\/jokercrm\/web(?=\/images\/)/, '');
  try {
    const url = new URL(path, 'https://crm.rf39.ru');
    if (!['https://crm.rf39.ru', 'https://rf39.ru'].includes(url.origin) || url.username || url.password ||
        url.search || url.hash || !/^\/images\/objects\/[a-zA-Z0-9/_-]+\.(?:jpe?g|png|webp)$/i.test(url.pathname))
      return null;
    return url.href;
  } catch { return null; }
}

export function rf39Draft(item: Rf39Object, type: 'complex' | 'apartment' = rf39IsComplex(item) ? 'complex' : 'apartment', missingPolicy: 'main' | 'draft' = 'main') {
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
  const developmentTitle = item.development?.title?.trim() || '';
  const readiness = formatReadiness(year ? `${quarter ? quarter + ' кв. ' : ''}${year}` : 'Уточняется');
  const warnings: string[] = [];
  const number = (value: unknown, max: number, integer = false) => {
    const parsed = rf39Number(value);
    return parsed !== null && parsed <= max && (!integer || Number.isInteger(parsed)) ? parsed : null;
  };
  const price = number(item.price, 2000000000, true);
  if (price === null || price === 0) warnings.push('Цена не указана или требует проверки.');
  if (!validCoords && item.coordinates) warnings.push('Координаты CRM не распознаны.');
  const { description, requiresDraft } = rf39Description(item, missingPolicy);
  if (requiresDraft) warnings.push('Описание отсутствует. Проверьте карточку и добавьте описание.');
  if (type === 'complex' && layoutCount) warnings.push(`Импортирован корпус/ЖК. ${layoutCount} планировок остаются в CRM; отдельные квартиры не создавались.`);
  const area = type === 'apartment' ? number(param('area'), 10000) || null : null;
  const bedrooms = type === 'apartment' ? number(param('rooms'), 100, true) : null;
  const data = propertySchema.parse({
    housingMarket: type === 'apartment' ? (item.type === 'Квартиры в новостройках' ? 'newbuild' : 'secondary') : null,
    title: type === 'apartment' ? apartmentTitle(bedrooms, area)
      : developmentTitle.length >= 3 ? developmentTitle : item.title?.trim() || `Объект CRM №${item.id}`,
    slug: `robj-${item.id}`, type,
    location: item.city?.trim() || 'Уточняется', address: item.address || '',
    latitude: validCoords ? coords[0] : null, longitude: validCoords ? coords[1] : null,
    price: price || null, status: 'available',
    area, bedrooms,
    floors: number(param('floors-total'), 100, true) || null,
    availableFloors: type === 'apartment' && number(param('floor'), 100, true) ? [number(param('floor'), 100, true)!] : [],
    landArea: null, seaDistance: null, readiness,
    finish: String(param('renovation') || param('decoration') || 'Уточняется'),
    description, utilities: [], published: type === 'apartment', featured: false, elite: type === 'apartment', demo: false,
  });
  const normalizedImages = (item.images || []).map(rf39ImageUrl);
  const rejectedImages = normalizedImages.some(url => !url);
  const imageUrls = [...new Set(normalizedImages.filter((url): url is string => !!url))];
  if (rejectedImages || item.imagesIncomplete) warnings.push('Некоторые адреса фотографий отклонены или превышают лимит.');
  if (imageUrls.length > 100) warnings.push('В галерею можно перенести только первые 100 фотографий.');
  return {
    data: { ...data, sourceId: `rf39:${item.id}`, sourceName: 'CRM RF39', sourceMode: 'rf39-copy',
      sourceUrl: 'https://crm.rf39.ru', sourceFetchedAt: new Date(),
      developer: item.development?.developer?.title || null, district: item.district || null,
      constructionStatus: stage || null, priceKind: null,
      rf39ComplexId: item.development?.id ? String(item.development.id) : null,
      rf39BuildingId: item.complex?.id ? String(item.complex.id) : null,
    },
    imageUrls: imageUrls.slice(0, 100), planImageUrls: [] as string[], imagesIncomplete: !!item.imagesIncomplete || rejectedImages || imageUrls.length > 100, warnings, requiresDraft,
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
    apartment: layout.apartment, description: layout.description, external_description: layout.external_description, price: layout.price,
    images: layout.images, imagesIncomplete: layout.imagesIncomplete, params,
  }, 'apartment');
  draft.data.sourceId = `rf39-layout:${parent.id}:${id}`;
  draft.data.slug = `robj-layout-${parent.id}-${id}`;
  return draft;
}
