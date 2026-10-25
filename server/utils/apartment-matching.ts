import type { NmarketObject } from './nmarket-data';
import { rf39Number, type Rf39Object } from './rf39-data';
import { numberedAddress } from './complex-matching';

const text = (value: string | null | undefined) => (value || '').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
export function apartmentNumber(value: string | null | undefined) {
  const number = text(value).replace(/^(?:квартира|кв\.?)\s*№?\s*/u, '').replace(/^№\s*/, '');
  return /^\d+[а-яa-z]?(?:[/-]\d+[а-яa-z]?)?$/u.test(number) ? number.replace(/^0+(?=\d)/, '') : '';
}
export function apartmentAddress(city: string, address: string) {
  const location = text(city).replace(/^(?:город\s+|г\.\s*|г\s+)/u, '');
  const street = numberedAddress(address);
  return location && street ? `${location}|${street}` : '';
}
export type ApartmentIdentity = {
  sourceId: string; apartment: string; address: string; building: string;
  floor: number | null; rooms: number | null; area: number | null;
};
export function nmarketApartmentIdentity(item: NmarketObject): ApartmentIdentity {
  const section = text(item.buildingSection), phase = text(item.buildingPhase);
  return { sourceId: `nmarket:${item.id}`, apartment: apartmentNumber(item.apartmentNumber),
    address: apartmentAddress(item.location, item.address), building: /^\d{1,20}$/.test(item.buildingId || '') && section.length <= 200 && phase.length <= 200 ? JSON.stringify([item.buildingId, section, phase]) : '',
    floor: item.floor ?? null, rooms: item.bedrooms, area: item.area };
}
export function rf39ApartmentIdentity(item: Rf39Object, layoutId?: number): ApartmentIdentity {
  const layout = layoutId == null ? undefined : Object.values(item.layouts || {}).find(value => value.id === layoutId);
  const params = layout ? layout.params : item.params;
  return { sourceId: layoutId == null ? `rf39:${item.id}` : `rf39-layout:${item.id}:${layoutId}`,
    apartment: apartmentNumber(layout ? layout.apartment : item.apartment),
    address: apartmentAddress(item.city || '', item.address || ''), building: item.complex?.id ? String(item.complex.id) : '',
    floor: rf39Number(params?.floor?.value), rooms: rf39Number(params?.rooms?.value), area: rf39Number(params?.area?.value) };
}
export function compatibleApartments(left: ApartmentIdentity, right: ApartmentIdentity) {
  return !!left.apartment && !!left.address && left.apartment === right.apartment && left.address === right.address &&
    (['floor', 'rooms', 'area'] as const).every(field => left[field] == null || right[field] == null || left[field] === right[field]);
}
function buildingCounts(items: ApartmentIdentity[]) {
  const buildings = new Map<string, Set<string>>();
  for (const item of items) if (item.address) {
    if (!buildings.has(item.address)) buildings.set(item.address, new Set());
    // An unknown corpus prevents claiming that an address belongs to one known building.
    buildings.get(item.address)!.add(item.building || 'unknown');
  }
  return buildings;
}
export function nmarketApartmentKeys(items: NmarketObject[]) {
  const identities = items.filter(item => item.type === 'apartment' && item.supported).map(nmarketApartmentIdentity);
  const groups = new Map<string, ApartmentIdentity[]>();
  for (const identity of identities) if (identity.building && identity.apartment) {
    const key = `nmarket-building:${identity.building}:apartment:${identity.apartment}`;
    groups.set(key, [...(groups.get(key) || []), identity]);
  }
  const keys = new Map<string, string>();
  for (const [key, group] of groups) if (group.every(left => group.every(right => compatibleApartments(left, right))))
    for (const identity of group) keys.set(identity.sourceId, key);
  return keys;
}
export function matchNmarketApartments(items: NmarketObject[], crm: ApartmentIdentity[]) {
  const nmarket = items.filter(item => item.type === 'apartment' && item.supported).map(item => ({ item, identity: nmarketApartmentIdentity(item) }));
  const nBuildings = buildingCounts(nmarket.map(value => value.identity));
  const rBuildings = buildingCounts(crm);
  const keys = nmarketApartmentKeys(items);
  const matches = new Map<string, { id: string; key: string; identity: ApartmentIdentity }>();
  for (const identity of crm) {
    if (!identity.building || nBuildings.get(identity.address)?.size !== 1 || rBuildings.get(identity.address)?.size !== 1) continue;
    const sameUnit = crm.filter(other => other.building === identity.building && other.apartment === identity.apartment && other.address === identity.address);
    if (!sameUnit.every(left => sameUnit.every(right => compatibleApartments(left, right)))) continue;
    const matchesForApartment = nmarket.filter(candidate => keys.has(candidate.identity.sourceId) && compatibleApartments(candidate.identity, identity));
    const distinctKeys = new Set(matchesForApartment.map(candidate => keys.get(candidate.identity.sourceId)!));
    if (distinctKeys.size !== 1) continue;
    const preferred = matchesForApartment.sort((a, b) => a.item.id.localeCompare(b.item.id, 'en', { numeric: true }))[0]!;
    matches.set(identity.sourceId, { id: preferred.item.id, key: keys.get(preferred.identity.sourceId)!, identity });
  }
  return matches;
}

type CachedMatch = { id: string; key: string; identity: ApartmentIdentity; expires: number };
const matches = new Map<string, CachedMatch>();
const cacheKey = (complexId: string, sourceId: string, saved: boolean) => `${complexId}|${sourceId}|${saved}`;
export function cacheApartmentMatches(complexId: string, saved: boolean, values: ReturnType<typeof matchNmarketApartments>) {
  const now = Date.now();
  for (const [key, value] of matches) if (value.expires <= now || key.startsWith(`${complexId}|`) && key.endsWith(`|${saved}`)) matches.delete(key);
  for (const [sourceId, value] of values) matches.set(cacheKey(complexId, sourceId, saved), { ...value, expires: now + 10 * 60 * 1000 });
  while (matches.size > 20000) matches.delete(matches.keys().next().value!);
}
export function preferredNmarketApartment(complexId: string, sourceId: string, saved: boolean) {
  const value = matches.get(cacheKey(complexId, sourceId, saved));
  return value && value.expires > Date.now() ? value : undefined;
}
