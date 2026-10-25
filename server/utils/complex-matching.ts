import { rf39IsComplex, rf39Number, rf39Supported, type Rf39Object } from './rf39-data';

export type ComplexIdentity = {
  title: string; location: string; address: string; sourceId?: string | null;
  nmarketComplexId?: string | null; rf39ComplexId?: string | null; rf39BuildingId?: string | null;
};

const text = (value: string) => value.toLocaleLowerCase('ru').replace(/ё/g, 'е')
  .replace(/[«»„“”"']/g, '').replace(/[‐‑–—]/g, '-').replace(/\s*-\s*/g, '-')
  .replace(/\s+/g, ' ').trim();

export function complexName(value: string) {
  return text(value).replace(/^(?:жк|жилой комплекс)\s+/u, '').trim();
}

export function sameCity(left: string, right: string) {
  const city = (value: string) => text(value).replace(/^(?:г\.\s*|г\s+|город\s+)/u, '');
  return !!city(left) && city(left) === city(right);
}

export function numberedAddress(value: string) {
  const address = text(value).replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  // A street name containing a number alone (for example «8 Марта») is not a house address.
  if (!/\d+[а-яa-z]?(?:[/-]\d+[а-яa-z]?)?(?:\s+(?:к|корпус|корп|строение|стр)\s*[\da-zа-я]+)?$/iu.test(address)) return '';
  const words = address.replace(/\d+[а-яa-z]?/giu, '').split(/[\s/-]+/u)
    .filter(word => word && !['дом', 'д', 'корпус', 'корп', 'к', 'строение', 'стр'].includes(word));
  return words.some(word => /[а-яa-z]{2}/iu.test(word)) ? address : '';
}

export function sameNumberedAddress(left: Pick<ComplexIdentity, 'location' | 'address'>, right: Pick<ComplexIdentity, 'location' | 'address'>) {
  const address = numberedAddress(left.address);
  return !!address && sameCity(left.location, right.location) && address === numberedAddress(right.address);
}

export function isBuildingCard(item: ComplexIdentity) {
  return !!item.rf39BuildingId || /^rf39:\d+$/.test(item.sourceId || '') ||
    /(?:^|[\s(])(?:дом|корпус|корп\.?|литер|секция|строение)\s*№?\s*(?:\d[\p{L}\p{N}/-]*|[a-zа-я])(?:\s|[),]|$)/iu.test(item.title);
}

export function chooseExternalComplex<T extends { id: string | number; title: string; location: string }>(
  target: ComplexIdentity, items: T[], explicitId?: string | null,
) {
  const matches = explicitId ? items.filter(item => String(item.id) === explicitId) : items.filter(item =>
    !!complexName(target.title) && complexName(item.title) === complexName(target.title) && sameCity(item.location, target.location));
  return { item: matches.length === 1 ? matches[0] : undefined, matchedBy: explicitId ? 'ID ЖК' : 'название и город',
    warnings: matches.length > 1 ? ['Найдено несколько ЖК с одинаковым названием и городом. Укажите ID нужного ЖК.'] :
      matches.length === 0 ? [explicitId ? 'ЖК с указанным ID не найден в источнике.' : 'Не найдено точное совпадение названия ЖК и города. Укажите ID ЖК из источника.'] : [] };
}

export function matchesLocalApartment(target: ComplexIdentity, apartment: ComplexIdentity & { type: string }) {
  if (apartment.type !== 'apartment') return false;
  for (const field of ['nmarketComplexId', 'rf39ComplexId', 'rf39BuildingId'] as const)
    if (target[field] && apartment[field] && target[field] !== apartment[field]) return false;
  const parentId = target.sourceId?.match(/^rf39:(\d+)$/)?.[1];
  if (parentId && apartment.sourceId?.startsWith(`rf39-layout:${parentId}:`)) return true;
  if (target.rf39BuildingId && apartment.rf39BuildingId === target.rf39BuildingId) return true;
  const sameDevelopment = (target.nmarketComplexId && target.nmarketComplexId === apartment.nmarketComplexId) ||
    (target.rf39ComplexId && target.rf39ComplexId === apartment.rf39ComplexId);
  return (!!sameDevelopment && !isBuildingCard(target)) || sameNumberedAddress(target, apartment);
}

export function rf39ApartmentCandidate(item: Rf39Object) {
  return rf39Supported(item) && !rf39IsComplex(item) &&
    ((rf39Number(item.params?.area?.value) || 0) > 0 || rf39Number(item.params?.rooms?.value) !== null || !!item.apartment?.trim());
}

export type SourceMappings = Pick<ComplexIdentity, 'nmarketComplexId' | 'rf39ComplexId' | 'rf39BuildingId'>;

export function missingSourceMappings(before: ComplexIdentity, current: ComplexIdentity, mapping: SourceMappings) {
  const identity = ['title', 'location', 'address', 'sourceId'] as const;
  if (identity.some(field => before[field] !== current[field]) || isBuildingCard(before) !== isBuildingCard(current)) return null;
  const data: SourceMappings = {};
  for (const field of Object.keys(mapping) as (keyof SourceMappings)[]) {
    const value = mapping[field];
    if (!value) continue;
    // Independent source lookups may finish together; only conflicting changes invalidate this result.
    if ((current[field] && current[field] !== value) || (current[field] !== before[field] && current[field] !== value)) return null;
    if (!current[field]) data[field] = value;
  }
  return data;
}
