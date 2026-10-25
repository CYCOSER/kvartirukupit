<script setup lang="ts">
import { ArrowLeft, ArrowRight } from "lucide-vue-next";
import type { Property } from "~/shared/property";
import { loopScroll } from "~/shared/carousel";
const props = defineProps<{ items: Property[] }>();
const rail = ref<HTMLElement>();
const multiple = computed(() => props.items.length > 1);
const copies = computed(() => (multiple.value ? [0, 1, 2] : [1]));
let timer: ReturnType<typeof setTimeout> | undefined;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
let observer: IntersectionObserver | undefined;
let cardObserver: IntersectionObserver | undefined;
let resizeObserver: ResizeObserver | undefined;
let motion: MediaQueryList | undefined;
let visible = false;
let step = 0;

function normalize() {
  if (!rail.value || !multiple.value) return;
  const cycle = step * props.items.length;
  const left = rail.value.scrollLeft;
  if (left < cycle - 1 || left >= cycle * 2 - 1) {
    rail.value.scrollTo({ left: loopScroll(left, cycle), behavior: "instant" });
  }
}
function measure() {
  if (!rail.value) return;
  const card = rail.value.querySelector<HTMLElement>(".catalog-panel");
  step = (card?.getBoundingClientRect().width || 0) + 3;
  rail.value.scrollTo({
    left: multiple.value ? props.items.length * step : 0,
    behavior: "instant",
  });
}
function advance(direction: number) {
  normalize();
  if (!rail.value || !step) return;
  rail.value.scrollTo({
    left: (Math.round(rail.value.scrollLeft / step) + direction) * step,
    behavior: motion?.matches ? "instant" : "smooth",
  });
}
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const focusedCard = rail.value?.querySelector(
      ".catalog-panel:focus-within",
    );
    if (
      visible &&
      multiple.value &&
      !motion?.matches &&
      !document.hidden &&
      !focusedCard
    )
      advance(1);
    schedule();
  }, 5000);
}
function manual(direction: number) {
  advance(direction);
  schedule();
}
function touch() {
  schedule();
}
function onScroll() {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(normalize, 160);
}
onMounted(() => {
  motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  observer = new IntersectionObserver(
    ([entry]) => {
      visible = !!entry?.isIntersecting;
    },
    { threshold: 0.1 },
  );
  resizeObserver = new ResizeObserver(measure);
  if (rail.value) {
    observer.observe(rail.value);
    resizeObserver.observe(rail.value);
    // Only the visible copies are interactive, including across the loop seam.
    cardObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(({ target, isIntersecting }) => {
          target.toggleAttribute("inert", !isIntersecting);
          target.setAttribute("aria-hidden", String(!isIntersecting));
        });
      },
      { root: rail.value, threshold: 0 },
    );
    rail.value
      .querySelectorAll(".catalog-panel")
      .forEach((card) => cardObserver?.observe(card));
  }
  measure();
  schedule();
});
onBeforeUnmount(() => {
  clearTimeout(timer);
  clearTimeout(settleTimer);
  observer?.disconnect();
  cardObserver?.disconnect();
  resizeObserver?.disconnect();
});
</script>
<template>
  <div
    class="property-carousel"
    :style="{ '--count': Math.max(1, items.length) }"
    role="region"
    aria-roledescription="карусель"
    aria-label="Новостройки каталога"
  >
    <div
      ref="rail"
      class="carousel-rail"
      @scroll="onScroll"
      @scrollend="normalize"
      @touchstart.passive="touch"
      @keydown.left.prevent="manual(-1)"
      @keydown.right.prevent="manual(1)"
    >
      <PropertyPanels class="carousel-track">
        <template v-for="copy in copies" :key="copy">
          <PropertyCard
            v-for="property in items"
            :key="`${copy}-${property.id}`"
            :property="property"
            :show-arrow="false"
            class="catalog-panel"
            :inert="copy !== 1"
            :aria-hidden="copy !== 1 ? 'true' : undefined"
          />
        </template>
      </PropertyPanels>
    </div>
    <template v-if="multiple">
      <button
        type="button"
        class="carousel-arrow carousel-prev"
        aria-label="Предыдущие объекты"
        @click="manual(-1)"
      >
      <ArrowLeft :size="18" :stroke-width="1.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="carousel-arrow carousel-next"
        aria-label="Следующие объекты"
        @click="manual(1)"
      >
      <ArrowRight :size="18" :stroke-width="1.5" aria-hidden="true" />
      </button>
    </template>
  </div>
</template>
<style scoped>
.property-carousel {
  position: relative;
  width: 100%;
}
.carousel-rail {
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  overscroll-behavior-x: contain;
}
.carousel-rail::-webkit-scrollbar {
  display: none;
}
.carousel-track.property-grid.catalog-panels {
  --visible: min(3, var(--count));
  display: flex;
  gap: 3px;
}
.carousel-track :deep(.property-card.catalog-panel) {
  flex: 0 0 calc((100% - (var(--visible) - 1) * 3px) / var(--visible));
  min-width: 0;
}
.carousel-arrow {
  position: absolute;
  top: 42%;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  color: #163c66;
  background: #dde6f2;
  border: 1px solid #bdcadc;
  border-radius: 2px;
  box-shadow: 0 4px 16px #0b182a20;
  cursor: pointer;
  transform: translateY(-50%);
  transition: opacity 180ms ease, background-color 180ms ease, border-color 180ms ease;
}
.carousel-prev {
  left: 16px;
}
.carousel-next {
  right: 16px;
}
.carousel-arrow:hover {
  background: #bdcadc;
  border-color: #163c66;
}
.carousel-arrow:focus-visible {
  outline: 2px solid #dde6f2;
  outline-offset: 3px;
  box-shadow: 0 0 0 3px #163c66;
}
@media (hover: hover) and (pointer: fine) {
  .carousel-arrow {
    opacity: 0;
    pointer-events: none;
  }
  .property-carousel:hover .carousel-arrow,
  .property-carousel:focus-within .carousel-arrow {
    opacity: 1;
    pointer-events: auto;
  }
}
@media (any-pointer: coarse) {
  .carousel-arrow {
    width: 44px;
    height: 44px;
    opacity: 1;
    pointer-events: auto;
  }
}
@media (prefers-reduced-motion: reduce) {
  .carousel-arrow {
    transition: none;
  }
}
@media (min-width: 1600px) {
  .carousel-track.property-grid.catalog-panels {
    --visible: min(4, var(--count));
  }
}
@media (max-width: 900px) {
  .carousel-track.property-grid.catalog-panels {
    --visible: min(2, var(--count));
  }
}
@media (max-width: 600px) {
  .carousel-track.property-grid.catalog-panels {
    --visible: 1;
  }
  .carousel-prev {
    left: 10px;
  }
  .carousel-next {
    right: 10px;
  }
}
</style>
