<script setup lang="ts">
import { MapPin } from "lucide-vue-next";
import {
  formatReadiness,
  money,
  propertyAddress,
  type Property,
} from "~/shared/property";

type RecommendedProject = Pick<
  Property,
  | "id"
  | "title"
  | "slug"
  | "images"
  | "status"
  | "address"
  | "location"
  | "priceKind"
  | "price"
  | "readiness"
  | "constructionStatus"
>;

const props = defineProps<{ project: RecommendedProject }>();

const readiness = computed(
  () =>
    formatReadiness(
      props.project.readiness,
      props.project.constructionStatus,
    ) || "Уточняется",
);
const constructionStatus = computed(() => {
  const value = props.project.constructionStatus?.trim();
  return value ? value[0].toLocaleUpperCase("ru") + value.slice(1) : "";
});
</script>

<template>
  <NuxtLink
    :to="'/catalog/' + project.slug"
    class="recommended-project-card"
    :aria-label="project.title"
  >
    <div class="recommended-project-image">
      <img
        v-if="project.images[0]"
        :src="project.images[0].file"
        :alt="project.images[0].alt"
        loading="lazy"
      />
      <span v-else>Фотографии пока не добавлены</span>
    </div>
    <div class="recommended-project-content">
      <p class="recommended-project-address">
        <MapPin :size="14" aria-hidden="true" />
        <span>{{ propertyAddress(project) }}</span>
      </p>
      <h3>{{ project.title }}</h3>
      <div class="recommended-project-details">
        <div class="recommended-project-price">
          <span
            v-if="
              project.price != null &&
              ['from', 'minimum'].includes(project.priceKind || '')
            "
            class="recommended-project-from"
          >
            от
          </span>
          <strong>{{ money(project.price) }}</strong>
        </div>
        <span class="recommended-project-readiness">{{ readiness }}</span>
      </div>
      <span
        v-if="constructionStatus"
        class="recommended-project-status"
        :class="{
          'is-completed': constructionStatus.toLocaleLowerCase('ru') === 'сдан',
        }"
      >
        {{ constructionStatus }}
      </span>
    </div>
  </NuxtLink>
</template>

<style scoped>
.recommended-project-card {
  display: block;
  overflow: hidden;
  border: 1px solid #dfe6f1;
  border-radius: 10px;
  background: #fff;
  color: #354d70;
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease,
    translate 180ms ease;
}
.recommended-project-card:hover {
  translate: 0 -2px;
  border-color: #b6c9e9;
  box-shadow: 0 8px 20px #102f5012;
}
.recommended-project-card:focus-visible {
  outline: 2px solid #245fbd;
  outline-offset: 3px;
}
.recommended-project-image {
  display: grid;
  aspect-ratio: 1.32;
  place-items: center;
  overflow: hidden;
  background: #edf2f8;
  color: #75849a;
  font-size: 11px;
  text-align: center;
}
.recommended-project-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.recommended-project-content {
  display: grid;
  gap: 10px;
  padding: 14px;
}
.recommended-project-address {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  color: #687b93;
  font-size: 11px;
  line-height: 1.45;
}
.recommended-project-address svg {
  flex: 0 0 auto;
  margin-top: 1px;
}
.recommended-project-content h3 {
  color: #2e4565;
  font-size: 14px;
  font-weight: 650;
  line-height: 1.35;
}
.recommended-project-details {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  border-top: 1px solid #e5eaf2;
  padding-top: 10px;
}
.recommended-project-price {
  display: flex;
  align-items: baseline;
  gap: 5px;
}
.recommended-project-price .recommended-project-from {
  color: #687b93;
  font-size: 10px;
}
.recommended-project-price strong {
  color: #245fbd;
  font-size: 15px;
  font-weight: 750;
}
.recommended-project-price span,
.recommended-project-readiness {
  color: #687b93;
  font-size: 10px;
  line-height: 1.4;
}
.recommended-project-readiness {
  text-align: right;
}
.recommended-project-status {
  justify-self: start;
  border-radius: 5px;
  padding: 4px 7px;
  background: #edf3ff;
  color: #245fbd;
  font-size: 10px;
  font-weight: 650;
}
.recommended-project-status.is-completed {
  background: #edf8f1;
  color: #267d63;
}
@media (prefers-reduced-motion: reduce) {
  .recommended-project-card {
    transition: none;
  }
}
</style>
