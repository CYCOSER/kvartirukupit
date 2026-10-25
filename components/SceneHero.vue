<script setup lang="ts">
withDefaults(
  defineProps<{
    image?: string;
    alt: string;
    edgeShade?: boolean;
  }>(),
  { edgeShade: true },
);
</script>
<template>
  <section
    class="scene-hero scene-editorial"
    :class="{ 'scene-edge-shade': edgeShade }"
  >
    <img
      v-if="image"
      class="scene-photo"
      :src="image"
      :alt="alt"
      width="1672"
      height="941"
      fetchpriority="high"
    />
    <div class="scene-shade" />
    <div class="shell scene-grid">
      <div class="scene-panel"><slot /></div>
      <div v-if="$slots.aside" class="scene-aside"><slot name="aside" /></div>
    </div>
  </section>
</template>
<style scoped>
.scene-hero {
  position: relative;
  isolation: isolate;
  clip-path: inset(0);
  min-height: 620px;
  display: grid;
  align-items: end;
  background: #102f50;
  color: #f2f6fb;
}
.scene-photo,
.scene-shade {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: -1;
}
.scene-photo {
  position: fixed;
  object-fit: cover;
}
.scene-grid {
  display: grid;
  align-items: end;
}
.scene-aside {
  max-width: 300px;
  justify-self: end;
}
.scene-panel :deep(h1) {
  letter-spacing: -0.055em;
  font-weight: 400;
  margin: 22px 0;
}
.scene-panel :deep(h1 em) {
  color: #ccd6e3;
}
.scene-editorial .scene-panel :deep(h1.type-pair) {
  font-size: clamp(34px, 4.4vw, 64px);
  margin-block: 28px 36px;
}
.scene-panel :deep(.eyebrow) {
  color: #cad5e3;
  font-size: 10px;
  letter-spacing: 0.17em;
}
.scene-panel :deep(p:not(.eyebrow)) {
  color: #dfe8f3;
  font-size: 14px;
  line-height: 1.8;
  max-width: 440px;
}
.scene-panel :deep(.breadcrumb) {
  color: #d4e0ef;
}
.scene-panel :deep(.text-link) {
  color: #f2f6fb;
  border-color: #ffffff60;
  margin-top: 26px;
  width: fit-content;
}
.scene-aside :deep(p) {
  font-size: 13px;
  line-height: 1.8;
  color: #d4e0ef;
  margin-top: 16px;
}
.scene-aside :deep(strong) {
  display: block;
  font-weight: 400;
  letter-spacing: -0.03em;
}
.scene-aside :deep(small) {
  display: block;
  font-size: 10px;
  letter-spacing: 0.14em;
  color: #cad5e3;
  margin-bottom: 14px;
}
@media (max-width: 800px) {
  .scene-panel {
    max-width: 620px;
  }
  .scene-aside {
    justify-self: start;
  }
}
@media (max-width: 540px) {
  .scene-editorial .scene-panel :deep(h1.type-pair) {
    --script-indent: 0.25em;
    font-size: clamp(25px, 6.8vw, 36px);
  }
}
.scene-editorial {
  padding: 155px 0 64px;
}
.scene-editorial .scene-shade {
  background: linear-gradient(90deg, #0c1b2ec9, #0c1b2e70);
}
.scene-editorial .scene-grid {
  grid-template-columns: minmax(0, 1fr) 270px;
  gap: 72px;
}
.scene-editorial .scene-panel {
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 0;
  backdrop-filter: none;
  box-shadow: none;
}
.scene-editorial .scene-panel :deep(h1) {
  font-size: clamp(44px, 5.2vw, 78px);
  line-height: 1.06;
}
.scene-editorial .scene-panel :deep(.breadcrumb) {
  margin-bottom: 44px;
  font-size: 11px;
}
.scene-editorial .scene-aside {
  border-left: 1px solid #ffffff38;
  padding: 0 0 6px 28px;
}
.scene-editorial .scene-aside :deep(strong) {
  font-size: 24px;
  line-height: 1.3;
}
@media (max-width: 1000px) {
  .scene-editorial .scene-grid {
    grid-template-columns: minmax(0, 1fr) 220px;
    gap: 40px;
  }
}
@media (max-width: 800px) {
  .scene-editorial {
    min-height: 0;
    padding: 124px 0 40px;
  }
  .scene-editorial .scene-grid {
    grid-template-columns: 1fr;
    gap: 36px;
  }
  .scene-editorial .scene-aside {
    max-width: 480px;
    padding: 22px 0 0;
    border-left: 0;
    border-top: 1px solid #ffffff38;
  }
  .scene-editorial .scene-panel :deep(h1) {
    font-size: clamp(38px, 6.8vw, 60px);
  }
  .scene-editorial .scene-panel :deep(.breadcrumb) {
    margin-bottom: 30px;
  }
}
</style>
