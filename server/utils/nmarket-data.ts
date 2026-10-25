import sax from 'sax';
import { StringDecoder } from 'node:string_decoder';
import { apartmentTitle, formatReadiness, propertySchema } from '../../shared/property';

export const NMARKET_SOURCE = 'https://klg.nmarket.pro/novostroyki';
const fields = new Set(['type', 'property-type', 'category', 'description', 'complex-description',
  'rooms', 'studio', 'floor', 'floors-total', 'building-name', 'building-state', 'built-year',
  'ready-quarter', 'nmarket-complex-id', 'nmarket-building-id', 'building-section', 'building-phase', 'renovation', 'location/locality-name', 'location/address', 'location/apartment',
  'location/district', 'location/latitude', 'location/longitude', 'price/value', 'price/currency', 'area/value', 'area/unit']);
type Image = { url: string; plan: boolean };
export type NmarketObject = {
  id: string; type: 'apartment' | 'complex'; title: string; location: string; address: string;
  price: number | null; area: number | null; bedrooms: number | null; floors: number | null;
  latitude: number | null; longitude: number | null; developer: string | null; district: string | null;
  description: string; readiness: string; finish: string; constructionStatus: string | null;
  completionDate: string | null; supported: boolean; images: Image[]; rejectedImages: boolean;
  complexId: string | null; complexName: string; complexDescription: string; offerCount: number;
  apartmentNumber?: string; buildingId?: string; buildingSection?: string; buildingPhase?: string; floor?: number | null;
};

function numeric(value: string | undefined, max: number, integer = false, min = 0) {
  if (!value || !/^-?\d+(?:[.,]\d+)?$/.test(value.trim())) return null;
  const number = Number(value.trim().replace(',', '.'));
  return Number.isFinite(number) && number >= min && number <= max && (!integer || Number.isInteger(number)) ? number : null;
}

function plain(value = '') {
  return value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/(?:p|div)>/gi, '\n\n')
    .replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}

export function nmarketImageUrl(value: string) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== 'img.nmarket.pro' ||
        url.port || url.username || url.password || url.hash ||
        !/^\/photo\/pid\/[a-f\d-]{36}\/$/i.test(url.pathname) || url.href.length > 2000) return null;
    url.protocol = 'https:';
    return url.href;
  } catch { return null; }
}

function apartment(id: string, values: Record<string, string>, images: Image[], rejectedImages: boolean): NmarketObject {
  const v = (key: string) => values[key] || '';
  const bedrooms = v('studio') === '1' ? 0 : numeric(v('rooms'), 100, true);
  const area = /^(кв\.?\s*м|м[²2])$/i.test(v('area/unit')) ? numeric(v('area/value'), 10000, false, 0.01) : null;
  const complexId = /^\d{1,20}$/.test(v('nmarket-complex-id')) ? v('nmarket-complex-id') : null;
  const complexName = v('building-name');
  const description = plain(v('description'));
  const year = numeric(v('built-year'), 2100, true, 1900);
  const quarter = numeric(v('ready-quarter'), 4, true, 1);
  const constructionStatus = ({ 'hand-over': 'Сдан', unfinished: 'Строится', planned: 'Проект' } as Record<string, string>)[v('building-state')] || null;
  const latitude = numeric(v('location/latitude'), 90, false, -90);
  const longitude = numeric(v('location/longitude'), 180, false, -180);
  return {
    id: `apartment:${id}`, type: 'apartment',
    title: apartmentTitle(bedrooms, area),
    location: v('location/locality-name'), address: v('location/address'),
    price: ['RUR', 'RUB'].includes(v('price/currency')) ? numeric(v('price/value'), 2000000000, true, 1) : null,
    area, bedrooms, floors: numeric(v('floors-total'), 100, true, 1),
    apartmentNumber: v('location/apartment'), buildingId: v('nmarket-building-id'),
    buildingSection: v('building-section'), buildingPhase: v('building-phase'), floor: numeric(v('floor'), 100, true, 1),
    latitude: longitude === null ? null : latitude, longitude: latitude === null ? null : longitude,
    developer: description.split(/\r?\n/)[0]?.match(/Застройщик:\s*(.+)$/i)?.[1]?.replace(/\.$/, '').trim() || null,
    district: v('location/district') || null, description,
    readiness: formatReadiness(year ? `${quarter ? quarter + ' кв. ' : ''}${year}` : 'Уточняется'),
    completionDate: year && quarter ? new Date(Date.UTC(year, quarter * 3, 0)).toISOString().slice(0, 10) : null,
    finish: v('renovation') || 'Уточняется', constructionStatus,
    supported: v('type') === 'продажа' && v('property-type') === 'жилая' && v('category') === 'квартира',
    images, rejectedImages, complexId, complexName, complexDescription: plain(v('complex-description')), offerCount: 1,
  };
}

// Keep only card fields while streaming: the feed repeats descriptions and includes private agent contacts.
export async function parseNmarketSnapshot(chunks: AsyncIterable<Uint8Array>, limit = 128 * 1024 * 1024) {
  const parser = sax.parser(true, { strictEntities: true });
  const decoder = new StringDecoder('utf8');
  const items: NmarketObject[] = [];
  const ids = new Set<string>();
  const stack: { name: string; text: string; capture: boolean; plan: boolean }[] = [];
  let size = 0, root = false, offerId = '', values: Record<string, string> = {}, images: Image[] = [], rejectedImages = false;
  let generationDate: string | null = null;
  parser.onerror = error => { throw error; };
  parser.ondoctype = () => { throw new Error('DTD is not supported'); };
  parser.onopentag = node => {
    if (!stack.length) {
      if (root || node.name !== 'realty-feed' || node.attributes.xmlns !== 'http://webmaster.yandex.ru/schemas/feed/realty/2010-06') throw new Error('Invalid feed root');
      root = true;
    }
    if (stack.length > 8) throw new Error('XML nesting limit');
    if (node.name === 'offer') {
      offerId = node.attributes['internal-id'] || '';
      if (stack.length !== 1 || !/^\d{1,20}$/.test(offerId) || ids.has(offerId) || ids.size >= 20000) throw new Error('Invalid or duplicate offer');
      ids.add(offerId); values = {}; images = []; rejectedImages = false;
    }
    const path = [...stack.slice(2).map(frame => frame.name), node.name].join('/');
    stack.push({ name: node.name, text: '', capture: (stack.length === 1 && node.name === 'generation-date') || (!!offerId && (fields.has(path) || path === 'image')), plan: ['plan', 'floorplan'].includes(node.attributes.tag || '') });
  };
  parser.ontext = parser.oncdata = text => {
    const frame = stack.at(-1);
    if (frame?.capture) {
      frame.text += text;
      if (frame.text.length > 100000) throw new Error('XML field limit');
    }
  };
  parser.onclosetag = name => {
    const path = stack.slice(2).map(frame => frame.name).join('/');
    const frame = stack.pop()!;
    if (frame.capture) {
      const text = frame.text.trim();
      if (stack.length === 1 && name === 'generation-date') {
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text) && Number.isFinite(Date.parse(text))) generationDate = new Date(text).toISOString();
      } else if (path === 'image') {
        const url = nmarketImageUrl(text);
        const existing = images.find(image => image.url === url);
        if (existing) existing.plan ||= frame.plan;
        else if (!url || images.length >= 100) rejectedImages = true;
        else images.push({ url, plan: frame.plan });
      } else {
        if (values[path] !== undefined) throw new Error('Duplicate XML field');
        values[path] = text;
      }
    }
    if (name === 'offer') {
      items.push(apartment(offerId, values, images, rejectedImages)); offerId = '';
    }
  };
  for await (const chunk of chunks) {
    size += chunk.byteLength;
    if (size > limit) throw new Error('NMarket response too large');
    parser.write(decoder.write(chunk));
  }
  parser.write(decoder.end()).close();
  if (!root) throw new Error('Empty feed');
  const complexes = new Map<string, NmarketObject>();
  const planUrls = new Set(items.flatMap(item => item.images.filter(image => image.plan).map(image => image.url)));
  for (const item of items) {
    if (!item.supported || !item.complexId) continue;
    const key = item.complexId;
    let complex = complexes.get(key);
    if (!complex) {
      complex = { ...item, id: `complex:${key}`, type: 'complex', title: item.complexName || `ЖК №${key}`,
        description: item.complexDescription, area: null, bedrooms: null, images: [], offerCount: 0 };
      complexes.set(key, complex);
    }
    complex.offerCount++;
    // A missing price prevents claiming a verified minimum for the whole complex.
    complex.price = complex.price === null || item.price === null ? null : Math.min(complex.price, item.price);
    complex.floors = complex.floors === null || item.floors === null ? null : Math.max(complex.floors, item.floors);
    if (item.completionDate && (!complex.completionDate || item.completionDate > complex.completionDate)) {
      complex.completionDate = item.completionDate; complex.readiness = item.readiness;
    }
    if (complex.finish !== item.finish) complex.finish = 'Зависит от квартиры';
    if (complex.constructionStatus !== item.constructionStatus) complex.constructionStatus = 'Разные сроки по корпусам';
    if (complex.address !== item.address) complex.address = '';
    for (const image of item.images) {
      if (planUrls.has(image.url) || complex.images.some(other => other.url === image.url)) continue;
      if (complex.images.length < 100) complex.images.push(image);
      else complex.rejectedImages = true;
    }
    complex.rejectedImages ||= item.rejectedImages;
  }
  return { items: [...complexes.values(), ...items], generationDate };
}

export async function parseNmarketFeed(chunks: AsyncIterable<Uint8Array>, limit?: number) {
  return (await parseNmarketSnapshot(chunks, limit)).items;
}

export function nmarketSummary(item: NmarketObject) {
  return { id: item.id, title: item.title, category: item.type === 'complex' ? 'Жилые комплексы' : 'Квартиры',
    location: item.location, address: item.address, price: item.price, area: item.area,
    bedrooms: item.bedrooms, floors: item.floors, developer: item.developer, supported: item.supported };
}

export function nmarketDraft(item: NmarketObject, snapshotDate?: string) {
  if (!item.supported) throw new Error('Поддерживается только продажа квартир и ЖК.');
  const plans = item.images.filter(image => image.plan);
  const planUrls = new Set(plans.map(image => image.url));
  const photos = item.images.filter(image => !planUrls.has(image.url));
  const warnings: string[] = [];
  if (snapshotDate) warnings.push(`Сохранённая выгрузка от ${snapshotDate}. Проверьте актуальность цены и наличия перед публикацией.`);
  if (!item.price) warnings.push('Цена не указана или требует проверки.');
  if (item.rejectedImages) warnings.push('Некоторые адреса фотографий отклонены или превышают лимит.');
  if (item.type === 'complex') warnings.push(`ЖК собран по ${item.offerCount} предложениям. Отдельные квартиры не создавались; адреса и сроки корпусов нужно проверить.`);
  const data = propertySchema.parse({
    title: item.type === 'apartment' ? apartmentTitle(item.bedrooms, item.area) : item.title,
    slug: `nmarket-${item.id.replace(':', '-')}`, type: item.type,
    location: item.location || 'Уточняется', address: item.address,
    latitude: item.latitude, longitude: item.longitude, price: item.price, status: 'available',
    area: item.area, bedrooms: item.bedrooms, floors: item.floors, landArea: null, seaDistance: null,
    description: item.description, readiness: formatReadiness(item.readiness, item.constructionStatus) || 'Уточняется', finish: item.finish,
    utilities: [], published: false, featured: false, elite: false, demo: false,
  });
  return { data: { ...data, sourceId: `nmarket:${item.id}`, sourceName: 'НМаркет.ПРО', sourceMode: 'nmarket-copy',
    sourceUrl: NMARKET_SOURCE, sourceFetchedAt: snapshotDate ? new Date(snapshotDate) : new Date(), developer: item.developer, district: item.district,
    constructionStatus: item.constructionStatus, completionDate: item.completionDate,
    priceKind: item.type === 'complex' && item.price !== null ? 'from' : null,
    priceSourceUrl: item.price !== null ? NMARKET_SOURCE : null,
    nmarketComplexId: item.complexId,
  }, imageUrls: (item.type === 'apartment' ? [...plans, ...photos] : photos).map(image => image.url),
  planImageUrls: item.type === 'apartment' ? [...planUrls] : [], warnings };
}
