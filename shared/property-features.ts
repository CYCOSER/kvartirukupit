import type { Property } from './property';

export function propertyFeatures(property: Pick<Property, 'heatingType' | 'fencedTerritory' | 'locationTags' | 'housingMarket' | 'complex'>) {
  if (property.housingMarket === 'secondary') return { heatingType: null, fencedTerritory: null, locationTags: [] };
  return {
    heatingType: property.heatingType?.trim() || property.complex?.heatingType?.trim() || null,
    fencedTerritory: property.fencedTerritory ?? property.complex?.fencedTerritory ?? null,
    locationTags: property.locationTags?.length ? property.locationTags : property.complex?.locationTags || [],
  };
}
