<script setup lang="ts">
import { BadgeCheck, Clock3, Construction, Fence, House, Landmark, MapPin, ThermometerSun, Trees, Waves } from 'lucide-vue-next';
import { propertyFeatures } from '~/shared/property-features';

const props = defineProps<{
  property: Parameters<typeof propertyFeatures>[0];
  constructionStatus?: string | null;
}>();
const features = computed(() => propertyFeatures(props.property));
const locationIcons: Record<string, typeof MapPin> = { 'Центр города': Landmark, 'У моря': Waves, 'У парка': Trees, 'За городом': House };
const groupIcons = { heating: ThermometerSun, territory: Fence, location: MapPin, other: BadgeCheck };
const status = computed(() => {
  const value = props.constructionStatus?.trim();
  return value ? value[0].toLocaleUpperCase('ru') + value.slice(1) : '';
});
const statusIcon = computed(() => {
  switch (status.value.toLocaleLowerCase('ru')) {
    case 'сдан': return BadgeCheck;
    case 'строится': return Construction;
    default: return Clock3;
  }
});
</script>

<template>
  <div v-if="features.length || status" class="property-features" aria-label="Особенности объекта">
    <span v-for="feature in features" :key="feature.id"><component :is="(feature.group === 'location' && locationIcons[feature.name]) || groupIcons[feature.group]" :size="16" aria-hidden="true" /><span>{{ feature.group === 'heating' ? 'Отопление: ' : '' }}{{ feature.name }}</span></span>
    <span v-if="status" class="property-construction-status"><component :is="statusIcon" :size="16" aria-hidden="true" /><span>{{ status }}</span></span>
  </div>
</template>

<style scoped>
.property-features {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 14px;
  color: #597b9e;
  font-size: 0.75rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.property-features > span {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 4px 7px;
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  border-radius: 5px;
}
.property-features svg {
  flex-shrink: 0;
}
</style>
