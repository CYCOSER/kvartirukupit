<script setup lang="ts">
import { ArrowUpRight, Building2, Maximize, MapPin } from "lucide-vue-next";
import { types, statuses, money, formatReadiness, propertyAddress, type Property } from "~/shared/property";
type CardProperty = Pick<Property,
  "title" | "slug" | "type" | "images" | "status" | "address" | "location" |
  "area" | "developer" | "constructionStatus" | "priceKind" | "priceArea" |
  "price" | "readiness" | "sourceMode" | "complex"
>;
const props = withDefaults(defineProps<{
  property: CardProperty;
  showArrow?: boolean;
  disclosure?: { expanded: boolean; id: string };
}>(), {
  showArrow: true,
});
defineEmits<{ toggle: [] }>();
const linkComponent = resolveComponent("NuxtLink");
const readiness = computed(() => formatReadiness(props.property.readiness, props.property.constructionStatus));
const development = computed(() => props.property.type === 'apartment'
  ? props.property.complex && 'ЖК ' + props.property.complex.title.replace(/^ЖК\s+/i, '')
  : props.property.developer);
const constructionStatus = computed(() => {
  const value = props.property.constructionStatus?.trim();
  return value ? value[0].toLocaleUpperCase('ru') + value.slice(1) : '';
});
</script>
<template>
  <component
    :is="disclosure ? 'div' : linkComponent"
    :to="disclosure ? undefined : '/catalog/' + property.slug"
    :aria-label="disclosure ? undefined : property.title"
    class="property-card"
    :class="{ 'card-disclosure': !!disclosure, 'is-expanded': disclosure?.expanded }"
  >
    <button
      v-if="disclosure"
      type="button"
      class="card-toggle"
      data-testid="catalog-map-toggle"
      :aria-expanded="disclosure.expanded"
      :aria-controls="disclosure.id"
      :aria-labelledby="disclosure.id + '-title ' + disclosure.id + '-price'"
      @click="$emit('toggle')"
    />
    <div class="card-image-link">
      <img
        v-if="property.images[0]"
        :src="property.images[0].file"
        :alt="property.images[0].alt"
        :class="{ 'is-plan': property.images[0].kind === 'plan' }"
        loading="lazy"
        width="700"
        height="520"
      />
      <div v-else class="empty-image">Фотографии пока не добавлены</div>
      <span class="card-type">{{ types[property.type] }}</span>
      <span v-if="property.status !== 'available'" class="card-status">{{
        statuses[property.status]
      }}</span>
      <span v-if="showArrow" class="card-open"
        ><ArrowUpRight :size="21" aria-hidden="true"
      /></span>
    </div>
    <div v-if="property.images[0]" class="card-photo-focus" aria-hidden="true">
      <img :src="property.images[0].file" alt="" loading="lazy" width="700" height="520" :class="{ 'is-plan': property.images[0].kind === 'plan' }" />
    </div>
    <div :id="disclosure?.id" class="card-body">
      <div class="card-reveal" :aria-hidden="disclosure ? !disclosure.expanded : undefined" :inert="disclosure ? !disclosure.expanded : undefined">
        <div class="card-reveal-content">
          <p class="card-location">
            <MapPin :size="14" aria-hidden="true" />
            <span>{{ propertyAddress(property) }}</span>
          </p>
        </div>
      </div>
      <h3 :id="disclosure ? disclosure.id + '-title' : undefined">{{ property.title }}</h3>
      <div class="card-reveal" :aria-hidden="disclosure ? !disclosure.expanded : undefined" :inert="disclosure ? !disclosure.expanded : undefined">
        <div class="card-reveal-content">
          <div class="card-specs">
            <span v-if="property.area != null"
              ><Maximize :size="16" aria-hidden="true" />{{ property.area }} м²</span
            >
            <span v-if="development"
              ><Building2 :size="16" aria-hidden="true" />{{ development }}</span
            >
            <span v-if="constructionStatus">{{
              constructionStatus
            }}</span>
          </div>
        </div>
      </div>
      <div :id="disclosure ? disclosure.id + '-price' : undefined" class="card-price">
        <div>
          <small v-if="property.type !== 'complex' && property.priceKind === 'example'">
            Цена квартиры<template v-if="property.priceArea">
              · {{ property.priceArea.toLocaleString("ru-RU") }} м²</template
            >
          </small>
          <div class="card-price-amount">
            <small v-if="property.type === 'complex' && property.price != null && ['from', 'minimum'].includes(property.priceKind || '')">от</small>
            <strong>{{ money(property.price) }}</strong>
          </div>
        </div>
        <span v-if="readiness" :aria-hidden="disclosure ? !disclosure.expanded : undefined">{{ readiness }}</span>
      </div>
      <div class="card-reveal" :aria-hidden="disclosure ? !disclosure.expanded : undefined" :inert="disclosure ? !disclosure.expanded : undefined">
        <div class="card-reveal-content">
          <p v-if="property.sourceMode === 'indexed'" class="card-source-note">
            Наличие и цену нужно уточнить
          </p>
          <slot name="details" />
          <NuxtLink v-if="disclosure" :to="'/catalog/' + property.slug" class="card-details-link" data-testid="catalog-map-detail" :tabindex="disclosure.expanded ? undefined : -1">Подробнее об объекте</NuxtLink>
        </div>
      </div>
    </div>
  </component>
</template>
<style scoped>
.property-card .card-image-link img.is-plan,
.property-card .card-photo-focus img.is-plan {
  object-fit: contain;
  background: #fff;
  transform: none;
}
.card-price > div {
  display: grid;
  gap: 5px;
}
.card-price small {
  font-size: 10px;
  font-weight: 400;
}
.card-price-amount { display: flex; align-items: baseline; gap: 6px; }
.card-price-amount small { font-size: 13px; }
.card-photo-focus { display: none; }
.card-source-note {
  margin-top: 12px;
  font-size: 10px;
  opacity: 0.8;
}
.empty-image {
  background: linear-gradient(145deg, #245fbd, #102f50);
}
.card-disclosure { position: relative; isolation: isolate; }
.card-toggle { position: absolute; inset: 0; z-index: 2; width: 100%; height: 100%; border: 0; background: transparent; }
.property-card.card-disclosure .card-body { z-index: 3; pointer-events: none; }
.card-toggle:focus-visible { outline: 2px solid #dce7f3; outline-offset: -4px; }
.card-disclosure .card-reveal { display: grid; grid-template-rows: 0fr; opacity: 0; visibility: hidden; transition: grid-template-rows .3s ease, opacity .22s ease, visibility .22s; }
.card-disclosure .card-reveal-content { min-height: 0; overflow: hidden; }
.card-disclosure.is-expanded .card-reveal { grid-template-rows: 1fr; opacity: 1; visibility: visible; }
.card-disclosure:not(.is-expanded) .empty-image { color: transparent; }
.card-disclosure .card-type, .card-disclosure .card-status, .card-disclosure .card-price > span { opacity: 0; visibility: hidden; transition: opacity .22s ease, visibility .22s; }
.card-disclosure.is-expanded .card-type, .card-disclosure.is-expanded .card-status, .card-disclosure.is-expanded .card-price > span { opacity: 1; visibility: visible; }
.card-details-link { display: inline-block; margin-top: 18px; color: #dce7f3; font-size: 12px; text-decoration: underline; text-underline-offset: 4px; pointer-events: auto; }
.card-details-link:hover { color: #fff; }
@media (prefers-reduced-motion: reduce) { .card-disclosure .card-reveal, .card-disclosure .card-type, .card-disclosure .card-status, .card-disclosure .card-price > span { transition: none; } }
</style>
