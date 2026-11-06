import { createError } from 'h3';
import sax from 'sax';
import { StringDecoder } from 'node:string_decoder';
import { apartmentTitle } from '../../shared/property';
import { DEFAULT_RF39_FEED_URL, feedSyncInputSchema } from '../../shared/feed-sync';
import { rf39ImageUrl, rf39Number, rf39ObjectSchema, type Rf39Object } from './rf39-data';

export { DEFAULT_RF39_FEED_URL };
export type Rf39Snapshot = {
  items: Rf39Object[]; presentIds: number[]; errors: { id: number | null; message: string }[];
  snapshotDate: string; authoritative: boolean;
};
const MAX_BYTES = 128 * 1024 * 1024;
const fields = new Set(['url', 'type', 'property-type', 'category', 'description', 'rooms', 'studio', 'floor', 'floors-total',
  'built-year', 'ready-quarter', 'building-state', 'building-name', 'new-flat', 'renovation', 'quality',
  'location/locality-name', 'location/address', 'location/apartment', 'location/sub-locality-name', 'location/district',
  'location/latitude', 'location/longitude', 'price/value', 'price/currency', 'area/value', 'area/unit']);

export function rf39FeedUrl(value: string) {
  return feedSyncInputSchema.shape.url.parse(value);
}

function sourceId(value: string | undefined): number | null {
  try {
    const url = new URL(value || '');
    const match = url.pathname.match(/^\/catalog\/(?:sale|rent)\/[^/]+\/object\/([1-9]\d*)\/?$/);
    const id = Number(match?.[1]);
    return ['https://rf39.ru', 'https://crm.rf39.ru'].includes(url.origin) && !url.username && !url.password && !url.search && !url.hash &&
      match && Number.isSafeInteger(id) ? id : null;
  } catch { return null; }
}

function feedObject(id: number, values: Record<string, string>, images: string[], imagesIncomplete: boolean): Rf39Object {
  const apartment = values.category === 'квартира' && values['property-type'] === 'жилая';
  const rooms = ['1', 'true', 'да'].includes(values.studio || '') ? 0 : rf39Number(values.rooms);
  const area = /^(?:кв\.?\s*м|м[²2])$/i.test(values['area/unit'] || '') ? rf39Number(values['area/value']) : null;
  const newbuild = ['1', 'true', 'да'].includes(values['new-flat'] || '');
  const params: Record<string, { value: string | number | null }> = { area: { value: area }, rooms: { value: rooms } };
  for (const name of ['floor', 'floors-total', 'built-year', 'ready-quarter', 'building-state', 'renovation'])
    if (values[name]) params[name] = { value: values[name]! };
  return rf39ObjectSchema.parse({
    id, title: apartment ? apartmentTitle(rooms, area) : `${values.category || 'Объект'} №${id}`,
    type: apartment ? (newbuild ? 'Квартиры в новостройках' : 'Квартиры - вторичное жильё') : values.category || 'Неизвестный тип',
    deal_type: values.type === 'продажа' ? 'sale' : 'unsupported',
    description: values.description || '', external_description: values.description || '',
    city: values['location/locality-name'] || '', address: values['location/address'] || '',
    apartment: values['location/apartment'] || null,
    district: values['location/sub-locality-name'] || values['location/district'] || null,
    coordinates: values['location/latitude'] && values['location/longitude'] ? [values['location/latitude'], values['location/longitude']] : null,
    price: ['RUR', 'RUB'].includes(values['price/currency'] || '') ? rf39Number(values['price/value']) : null,
    images, imagesIncomplete, params,
    // Yandex building IDs are not CRM IDs and must never overwrite existing source mappings.
    development: values['building-name'] ? { title: values['building-name'] } : null,
  });
}

export async function parseRf39Feed(chunks: AsyncIterable<Uint8Array>, limit = MAX_BYTES): Promise<Rf39Snapshot> {
  const parser = sax.parser(true, { strictEntities: true });
  const decoder = new StringDecoder('utf8');
  const stack: { name: string; text: string; capture: boolean }[] = [];
  const items: Rf39Object[] = [], presentIds = new Set<number>(), internalIds = new Set<string>();
  const errors: Rf39Snapshot['errors'] = [];
  let bytes = 0, root = false, offerId = '', values: Record<string, string> = {}, images: string[] = [];
  let invalid = false, ambiguousIdentity = false, rejectedImages = false, authoritative = true, snapshotDate = new Date().toISOString();
  parser.onerror = error => { throw error; };
  parser.ondoctype = () => { throw new Error('DTD is not supported'); };
  parser.onopentag = node => {
    if (!stack.length) {
      if (root || node.name !== 'realty-feed' || node.attributes.xmlns !== 'http://webmaster.yandex.ru/schemas/feed/realty/2010-06') throw new Error('Invalid feed root');
      root = true;
    }
    if (stack.length > 8) throw new Error('XML nesting limit');
    if (node.name === 'offer') {
      const id = node.attributes['internal-id'];
      if (stack.length !== 1 || typeof id !== 'string' || !id.trim() || id.length > 100 || internalIds.has(id) || internalIds.size >= 20000)
        throw new Error('Invalid or duplicate offer');
      internalIds.add(id); offerId = id; values = {}; images = []; invalid = false; ambiguousIdentity = false; rejectedImages = false;
    }
    const path = [...stack.slice(2).map(frame => frame.name), node.name].join('/');
    stack.push({ name: node.name, text: '', capture: stack.length === 1 && node.name === 'generation-date' || !!offerId && (fields.has(path) || path === 'image') });
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
      const value = frame.text.trim();
      if (stack.length === 1 && name === 'generation-date') {
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)))
          snapshotDate = new Date(value).toISOString();
      } else if (path === 'image') {
        const url = rf39ImageUrl(value);
        if (!url) rejectedImages = true;
        else if (!images.includes(url)) {
          if (images.length >= 100) rejectedImages = true;
          else images.push(url);
        }
      } else {
        if (values[path] !== undefined) { invalid = true; if (path === 'url' && values[path] !== value) ambiguousIdentity = true; }
        values[path] = value;
      }
    }
    if (name === 'offer') {
      const id = ambiguousIdentity ? null : sourceId(values.url);
      if (id === null) { authoritative = false; errors.push({ id: null, message: 'У объекта нет однозначного ID в публичной ссылке RF39.' }); }
      else {
        if (presentIds.has(id)) throw new Error('Duplicate RF39 object ID');
        presentIds.add(id);
        try {
          if (invalid) throw new Error('Duplicate fields');
          items.push(feedObject(id, values, images, rejectedImages));
          if (rejectedImages) errors.push({ id, message: 'Часть фотографий пропущена: недопустимый адрес или превышен лимит галереи.' });
        } catch { errors.push({ id, message: 'Данные объекта некорректны. Объект пропущен, его существующая карточка сохранена.' }); }
      }
      offerId = '';
    }
  };
  for await (const chunk of chunks) {
    bytes += chunk.byteLength;
    if (bytes > limit) throw new Error('RF39 feed exceeds limit');
    parser.write(decoder.write(chunk));
  }
  parser.write(decoder.end()).close();
  if (!root || !internalIds.size) throw new Error('Empty RF39 feed');
  return { items, presentIds: [...presentIds], errors, snapshotDate, authoritative };
}

export async function rf39ReadBody(response: Response, limit: number) {
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit) throw new Error('Invalid CRM response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('CRM response too large');
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel(); }
}

let cached: { source: string; expires: number; snapshot: Rf39Snapshot } | undefined;
const pending = new Map<string, Promise<Rf39Snapshot>>();
export async function fetchRf39Feed(source = DEFAULT_RF39_FEED_URL, refresh = false): Promise<Rf39Snapshot> {
  let url: string;
  try { url = rf39FeedUrl(source); }
  catch { throw createError({ statusCode: 400, data: { message: 'Укажите HTTPS-выгрузку feed.rf39.ru в формате /номер.xml.' } }); }
  if (!refresh && cached?.source === url && cached.expires > Date.now()) return cached.snapshot;
  const running = pending.get(url);
  if (running) return running;
  const promise = (async () => {
    try {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120000) });
      if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Invalid feed response');
      const reader = response.body.getReader();
      async function* chunks() {
        try { while (true) { const { done, value } = await reader.read(); if (done) break; yield value; } }
        finally { await reader.cancel(); }
      }
      const snapshot = await parseRf39Feed(chunks());
      cached = { source: url, expires: Date.now() + 10 * 60 * 1000, snapshot };
      return snapshot;
    } catch { throw createError({ statusCode: 502, data: { message: 'Не удалось прочитать полную XML-выгрузку CRM. Предыдущие данные сохранены; снятие объектов с публикации не выполняется.' } }); }
    finally { pending.delete(url); }
  })();
  pending.set(url, promise);
  return promise;
}

export async function fetchRf39Objects(source = DEFAULT_RF39_FEED_URL, offset = 0, id?: number | string) {
  if (!Number.isInteger(offset) || offset < 0 || id !== undefined && (!/^[1-9]\d*(?:,[1-9]\d*)*$/.test(String(id)) ||
      String(id).split(',').length > 100 || String(id).split(',').some(value => !Number.isSafeInteger(Number(value)))))
    throw createError({ statusCode: 400, data: { message: 'Некорректные ID объектов CRM.' } });
  const { items } = await fetchRf39Feed(source);
  if (id !== undefined) { const ids = new Set(String(id).split(',').map(Number)); return items.filter(item => ids.has(item.id)); }
  return items.slice(offset, offset + 100);
}
