import type { Property } from './property';
import { propertyFeatureGroups } from './property-feature';

export function propertyFeatures(property: Partial<Pick<Property, 'features' | 'featureOverrides' | 'housingMarket' | 'complex'>>) {
  if (property.housingMarket === 'secondary') return [];
  return propertyFeatureGroups.flatMap(group => {
    const source = !property.complex || property.featureOverrides?.includes(group)
      ? property.features : property.complex.features;
    return (source || []).filter(feature => feature.group === group);
  });
}
