import type { Property } from '../../../shared/property';

export function propertyFixture(values: Partial<Property> = {}): Property {
  return {
    id: 'property-fixture', title: 'Тестовая квартира', slug: 'property-fixture', type: 'apartment',
    housingMarket: 'newbuild', complexId: null, nmarketComplexId: null, rf39ComplexId: null, rf39BuildingId: null,
    location: 'Калининград', address: 'Тестовая, 1', latitude: null, longitude: null,
    price: 6000000, status: 'available', area: 50, landArea: null, bedrooms: 2, floors: 9, availableFloors: [],
    readiness: 'Готов', finish: 'Чистовая', seaDistance: null, description: 'Описание тестовой квартиры.', utilities: [],
    published: true, featured: false, elite: false, demo: false,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    sourceId: null, sourceUrl: null, sourceName: null, sourceMode: null, sourceNote: null, sourceFetchedAt: null,
    developer: null, district: null, completionDate: null, constructionStatus: null,
    priceKind: null, priceSourceUrl: null, priceArea: null, images: [], complex: null,
    ...values,
    priority: values.priority ?? 5,
  };
}
