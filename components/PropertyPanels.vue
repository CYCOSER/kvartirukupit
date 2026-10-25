<script setup lang="ts">
defineProps<{ compact?: boolean }>();
</script>
<template>
  <div class="property-grid catalog-panels" :class="{ 'catalog-panels-compact': compact }"><slot /></div>
</template>
<style scoped>
.property-grid.catalog-panels {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 3px;
  align-items: stretch;
}
.property-grid.catalog-panels :deep(.property-card.catalog-panel) {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: 1fr auto;
  position: relative;
  min-height: 590px;
  border: 0;
  border-radius: 0;
  padding: 0;
  box-shadow: none;
  background: #102f50;
  color: #f2f6fb;
  overflow: hidden;
  translate: none;
  transition: none;
}
.catalog-panels :deep(.card-image-link) {
  grid-area: 1 / 1 / 3 / 2;
  border-radius: 0;
  aspect-ratio: auto;
  min-height: 100%;
}
.catalog-panels :deep(.card-image-link img) {
  position: absolute;
  inset: 0;
  height: 100%;
  width: 100%;
  object-fit: cover;
}
/* Frame the clear photo separately while keeping the same photo behind the glass. */
.catalog-panels :deep(.card-photo-focus) {
  display: block;
  grid-area: 1 / 1;
  position: relative;
  min-height: 0;
  overflow: hidden;
  pointer-events: none;
}
.catalog-panels :deep(.card-photo-focus img) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}
.catalog-panels :deep(.card-type),
.catalog-panels :deep(.card-status),
.catalog-panels :deep(.card-open) { z-index: 1; }
.catalog-panels :deep(.card-image-link)::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(0deg, #0c1b2e50, transparent 60%);
  pointer-events: none;
}
.catalog-panels :deep(.card-body) {
  grid-area: 2 / 1;
  position: relative;
  z-index: 1;
  padding: 28px;
  isolation: isolate;
  overflow: hidden;
}
.catalog-panels :deep(.card-body)::before {
  content: "";
  position: absolute;
  inset: -24px;
  z-index: -1;
  pointer-events: none;
  /* Keep the blur's raster edge outside the visible card boundary. */
  background: linear-gradient(120deg, #0f2138b8, #163c6699);
  backdrop-filter: blur(20px);
}
.catalog-panels :deep(.card-body h3) {
  font-size: clamp(22px, 2vw, 30px);
  font-weight: 400;
  line-height: 1.2;
  margin: 14px 0 20px;
}
.catalog-panels :deep(.card-location),
.catalog-panels :deep(.card-specs),
.catalog-panels :deep(.card-price > span) {
  color: #d0dded;
}
.catalog-panels :deep(.card-price) {
  border-top: 1px solid #ffffff24;
}
.catalog-panels :deep(.card-price strong) {
  color: #ccd6e3;
  font-weight: 500;
  font-size: 24px;
}
.catalog-panels :deep(.card-type) {
  top: 24px;
  left: 24px;
  border: 0;
  border-radius: 0;
  background: #142b4980;
  padding: 9px 13px;
}
.catalog-panels :deep(.card-status) {
  top: 65px;
  left: 24px;
}
.catalog-panels :deep(.card-open) {
  top: 24px;
  bottom: auto;
  right: 24px;
  background: #142b4980;
  border: 0;
}
.catalog-panels :deep(a:focus-visible) {
  outline-color: #ccd6e3;
  outline-offset: -4px;
}
.catalog-panels :deep(.empty-image) {
  color: #d0dded;
  align-content: start;
  padding-top: 120px;
}
@media (min-width: 1280px) {
  .property-grid.catalog-panels {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .property-grid.catalog-panels :deep(.property-card.catalog-panel) {
    min-height: 560px;
  }
  .catalog-panels :deep(.card-body) {
    padding: 24px;
  }
}
@media (max-width: 600px) {
  .property-grid.catalog-panels {
    grid-template-columns: 1fr;
  }
  .property-grid.catalog-panels :deep(.property-card.catalog-panel) {
    min-height: 520px;
  }
  .catalog-panels :deep(.card-body) {
    padding: 24px;
  }
}
.property-grid.catalog-panels.catalog-panels-compact :deep(.property-card.catalog-panel) { min-height: 460px; }
.catalog-panels.catalog-panels-compact :deep(.card-body) { padding: 20px; }
.catalog-panels.catalog-panels-compact :deep(.card-body h3) { font-size: clamp(20px, 1.6vw, 24px); margin: 12px 0 16px; }
.catalog-panels.catalog-panels-compact :deep(.card-price strong) { font-size: 22px; }
</style>
