import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseExternalComplex, complexName, isBuildingCard, matchesLocalApartment, missingSourceMappings, numberedAddress, rf39ApartmentCandidate, sameCity, sameNumberedAddress } from '../server/utils/complex-matching';
import { fetchRf39Developments, parseRf39Developments, snapshotRf39Developments } from '../server/utils/rf39-developments';
import { fetchRf39Objects } from '../server/utils/rf39';

const target = { title: 'ЖК «Светлогорск-3»', location: 'Светлогорск', address: '' };
const apartment = { title: '2-комнатная квартира', type: 'apartment', location: 'Светлогорск', address: '' };

test('cross-source matching requires a unique exact name and city, or the explicit ID', () => {
  const item = { id: '46122', title: 'Светлогорск-3', location: 'Светлогорск' };
  assert.equal(chooseExternalComplex(target, [item]).item, item);
  assert.equal(complexName('Жилой комплекс «Светлогорск — 3»'), 'светлогорск-3');
  assert.equal(chooseExternalComplex(target, [{ ...item, title: 'Светлогорск-4' }]).item, undefined);
  assert.equal(chooseExternalComplex(target, [{ ...item, location: 'Калининград' }]).item, undefined);
  assert.equal(chooseExternalComplex(target, [item, { ...item, id: '2' }]).item, undefined);
  assert.equal(chooseExternalComplex(target, [item, { ...item, id: '2' }], '46122').item, item);
  assert.equal(chooseExternalComplex(target, [item], 'missing').item, undefined);
  assert.equal(sameCity('г. Гурьевск', 'Гурьевск'), true);
  assert.equal(sameCity('Гурьевск', 'Урьевск'), false);
  assert.equal(sameCity('город Светлогорск', 'Светлогорск'), true);
  assert.equal(sameCity('Гвардейск', 'г. Гвардейск'), true);
});

test('independent source discoveries can save together while conflicting edits cannot overwrite mappings', () => {
  const before = { ...target, nmarketComplexId: null, rf39ComplexId: null };
  assert.deepEqual(missingSourceMappings(before, { ...before, nmarketComplexId: '46122' }, { rf39ComplexId: '293' }), { rf39ComplexId: '293' });
  assert.deepEqual(missingSourceMappings(before, { ...before, rf39ComplexId: '293' }, { nmarketComplexId: '46122' }), { nmarketComplexId: '46122' });
  assert.deepEqual(missingSourceMappings(before, { ...before, rf39ComplexId: '293' }, { rf39ComplexId: '293' }), {});
  assert.equal(missingSourceMappings(before, { ...before, rf39ComplexId: '294' }, { rf39ComplexId: '293' }), null);
  assert.equal(missingSourceMappings({ ...before, rf39ComplexId: '293' }, before, { rf39ComplexId: '293' }), null);
  assert.equal(missingSourceMappings(before, { ...before, address: 'Другой адрес, 1' }, { rf39ComplexId: '293' }), null);
  assert.equal(missingSourceMappings(before, { ...before, rf39BuildingId: '782' }, { nmarketComplexId: '46122' }), null);
});

test('ambiguous empty CRM objects are not offered as individual apartments', () => {
  const item = { id: 17207, type: 'Квартиры в новостройках', deal_type: 'sale', title: 'Без характеристик', complex: { id: 784 } };
  assert.equal(rf39ApartmentCandidate(item), false);
  assert.equal(rf39ApartmentCandidate({ ...item, params: { area: { value: '42 м²' } } }), true);
  assert.equal(rf39ApartmentCandidate({ ...item, params: { rooms: { value: '0' } } }), true);
  assert.equal(rf39ApartmentCandidate({ ...item, apartment: '5' }), true);
  assert.equal(rf39ApartmentCandidate({ ...item, title: 'ЖК «Светлогорск-3» Дом 14' }), false);
});

test('building detection preserves the scope of imported corpora without treating arbitrary names as corpora', () => {
  assert.equal(isBuildingCard({ ...target, title: 'ЖК «Светлогорск-3» Дом 16' }), true);
  assert.equal(isBuildingCard({ ...target, title: 'ЖК «Берег» корпус А' }), true);
  assert.equal(isBuildingCard({ ...target, title: 'ЖК «Уютный дом»' }), false);
  assert.equal(isBuildingCard({ ...target, sourceId: 'rf39:17209' }), true);
  assert.equal(isBuildingCard({ ...target, rf39BuildingId: '782' }), true);
  assert.equal(isBuildingCard(target), false);
});

test('address fallback requires a real numbered house, exact address and the same city', () => {
  for (const value of ['', 'Ольховая', 'улица 8 Марта', 'Дом 16']) assert.equal(numberedAddress(value), '');
  const address = { location: 'Светлогорск', address: 'Ольховая ул., д. 32/7' };
  assert.equal(sameNumberedAddress(address, { ...address, address: 'ольховая ул. д. 32/7' }), true);
  assert.equal(sameNumberedAddress(address, { ...address, address: 'Ольховая ул., д. 32/8' }), false);
  assert.equal(sameNumberedAddress(address, { ...address, location: 'Калининград' }), false);
  assert.equal(sameNumberedAddress({ ...address, address: '' }, { ...address, address: '' }), false);
});

test('local matches use source relations or exact address, never names alone or all apartments of a neighbouring corpus', () => {
  assert.equal(matchesLocalApartment(target, { ...apartment, title: target.title }), false);
  assert.equal(matchesLocalApartment({ ...target, nmarketComplexId: '46122' }, { ...apartment, nmarketComplexId: '46122' }), true);
  const building = { ...target, sourceId: 'rf39:17209', rf39ComplexId: '293', rf39BuildingId: '782' };
  assert.equal(matchesLocalApartment(building, { ...apartment, rf39ComplexId: '293' }), false);
  assert.equal(matchesLocalApartment(building, { ...apartment, rf39BuildingId: '784', rf39ComplexId: '293' }), false);
  assert.equal(matchesLocalApartment(building, { ...apartment, rf39BuildingId: '782', rf39ComplexId: '293' }), true);
  assert.equal(matchesLocalApartment(building, { ...apartment, sourceId: 'rf39-layout:17209:2775' }), true);
  assert.equal(matchesLocalApartment(building, { ...apartment, sourceId: 'rf39-layout:172090:2775' }), false);
  const address = 'Ольховая ул., д. 32/7';
  assert.equal(matchesLocalApartment({ ...building, address }, { ...apartment, address }), true);
  assert.equal(matchesLocalApartment({ ...building, address }, { ...apartment, address, rf39BuildingId: '784' }), false);
  assert.equal(matchesLocalApartment({ ...target, address }, { ...apartment, address, type: 'complex' }), false);
});

test('development parsing retains only public relation fields and validates IDs', () => {
  const data = { id: 293, title: target.title, town: target.location, address: 'Ольховая/Дачная',
    contact: { phone: 'PRIVATE_CONTACT' }, info: 'PRIVATE_INFO', objects: { '17209': { id: 17209, contact: 'PRIVATE' } } };
  const parsed = parseRf39Developments({ code: 200, data: { '293': data } });
  assert.deepEqual(parsed, [{ id: 293, title: target.title, location: target.location, address: data.address, objectIds: [17209] }]);
  assert.doesNotMatch(JSON.stringify(parsed), /PRIVATE|contact|info/);
  assert.throws(() => parseRf39Developments({ code: 200, data: [data, data] }));
  assert.throws(() => parseRf39Developments({ code: 200, data: [{ ...data, objects: [{ id: -1 }] }] }));
});

test('RF39 relation lookup uses XML and validates IDs', async t => {
  const { rf39Xml, rf39Offer } = await import('./fixtures/rf39-feed');
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, options?: RequestInit) => {
    requests++; assert.equal(String(url), 'https://feed.rf39.ru/301.xml'); assert.equal(options?.body, undefined);
    return new Response(rf39Xml(rf39Offer(17209, '<building-name>ЖК Тест</building-name><yandex-building-id>293</yandex-building-id>')));
  });
  assert.equal((await fetchRf39Objects('https://feed.rf39.ru/301.xml', 0, '17209'))[0]!.id, 17209);
  assert.deepEqual(await fetchRf39Developments('https://feed.rf39.ru/301.xml'), []);
  for (const id of ['0', '-2', '17209,0', '1e3', Array(101).fill('1').join(',')]) await assert.rejects(fetchRf39Objects('https://feed.rf39.ru/301.xml', 0, id));
  await assert.rejects(fetchRf39Developments('https://feed.rf39.ru/301.xml', '293,294'));
  assert.equal(requests, 1);
});

test('saved CRM development relations retain only each development’s objects and exact name/city matching', () => {
  const base = { type: 'Квартиры в новостройках', deal_type: 'sale', city: target.location };
  const developments = snapshotRf39Developments([
    { ...base, id: 1, development: { id: 293 } },
    { ...base, id: 2, development: { id: 293, title: target.title } },
    { ...base, id: 3, development: { id: 294, title: 'Другой ЖК' } },
    { ...base, id: 4 },
  ]);
  assert.deepEqual(developments, [
    { id: 293, title: target.title, location: target.location, address: '', objectIds: [1, 2] },
    { id: 294, title: 'Другой ЖК', location: target.location, address: '', objectIds: [3] },
  ]);
  assert.deepEqual(chooseExternalComplex(target, developments).item?.objectIds, [1, 2]);
  assert.equal(chooseExternalComplex({ ...target, location: 'Калининград' }, developments).item, undefined);
  assert.equal(chooseExternalComplex({ ...target, title: 'Светлогорск-4' }, developments).item, undefined);
});
