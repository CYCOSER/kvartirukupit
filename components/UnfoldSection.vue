<script setup lang="ts">
import { nextUnfoldState, type UnfoldState } from "~/shared/unfold";
const track = ref<HTMLElement>();
const content = ref<HTMLElement>();
let state: UnfoldState = "before";
let enabled = false;
let animating = false;
let frame = 0;
let scrollFrame = 0;
let observer: ResizeObserver | undefined;
let preference: MediaQueryList | undefined;
let scrollRemainder = 0;
function navigateSection(event: Event) {
  const target = (event as CustomEvent<HTMLElement>).detail;
  if (!track.value || !enabled) return;
  if (
    track.value.contains(target) ||
    track.value.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING
  ) reveal(true);
}

function setHeight(height: number, keepBottom = false) {
  if (!track.value) return;
  const previous = track.value.getBoundingClientRect().bottom;
  track.value.style.height = `${height}px`;
  // Keep the reader in place when a fast scroll skips over an unopened section.
  if (keepBottom) {
    const delta = track.value.getBoundingClientRect().bottom - previous;
    const target = window.scrollY + delta + scrollRemainder;
    window.scrollTo({ top: target, behavior: "instant" });
    scrollRemainder = target - window.scrollY;
  }
}
function reveal(instant = false) {
  if (!track.value || !content.value) return;
  cancelAnimationFrame(frame);
  scrollRemainder = 0;
  const { top, height: from } = track.value.getBoundingClientRect();
  const to = content.value.offsetHeight;
  state = "open";
  if (instant || from === to) {
    setHeight(to, top < 0);
    animating = false;
    return;
  }
  animating = true;
  const start = performance.now();
  function tick(time: number) {
    const keepBottom = !!track.value && track.value.getBoundingClientRect().bottom <= 0;
    const progress = keepBottom ? 1 : Math.min(1, (time - start) / 650);
    const eased = progress * progress * (3 - 2 * progress);
    setHeight(from + (to - from) * eased, keepBottom);
    if (progress < 1) frame = requestAnimationFrame(tick);
    else {
      animating = false;
      if (content.value) setHeight(content.value.offsetHeight, keepBottom);
      schedule();
    }
  }
  frame = requestAnimationFrame(tick);
}
function update() {
  scrollFrame = 0;
  if (!enabled || state === "open" || !track.value) return;
  const { top } = track.value.getBoundingClientRect();
  const next = nextUnfoldState(state, top, window.innerHeight);
  if (next !== state) reveal(top < 0);
}
function schedule() {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(update);
}
function measure() {
  if (!track.value || !content.value) return;
  enabled = !preference?.matches;
  if (!enabled) {
    state = "open";
    cancelAnimationFrame(frame);
    animating = false;
    track.value.style.removeProperty("height");
    return;
  }
  if (!animating) setHeight(state === "open" ? content.value.offsetHeight : 0);
  schedule();
}
function revealFocus(event: FocusEvent) {
  if (
    !enabled ||
    !(event.target instanceof HTMLElement) ||
    !event.target.matches(":focus-visible")
  )
    return;
  reveal(true);
  event.target.scrollIntoView({ block: "center", behavior: "instant" });
}
onMounted(() => {
  preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  preference.addEventListener("change", measure);
  observer = new ResizeObserver(measure);
  if (content.value) observer.observe(content.value);
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", measure);
  window.addEventListener("unfold:navigate", navigateSection);
  measure();
});
onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  cancelAnimationFrame(scrollFrame);
  observer?.disconnect();
  preference?.removeEventListener("change", measure);
  window.removeEventListener("scroll", schedule);
  window.removeEventListener("resize", measure);
  window.removeEventListener("unfold:navigate", navigateSection);
});
</script>
<template>
  <div ref="track" class="unfold-track">
    <div
      ref="content"
      class="unfold-content"
      @focusin="revealFocus"
      @focusout="schedule"
    >
      <slot />
    </div>
  </div>
</template>
<style scoped>
.unfold-track {
  overflow: clip;
  display: flow-root;
  scroll-margin-top: 20vh;
  background:
    radial-gradient(ellipse at 0% 36%, #d0dded, transparent 60%), #eaf0f7;
}
.unfold-content {
  display: flow-root;
}
@media print {
  .unfold-track {
    height: auto !important;
    overflow: visible;
  }
}
</style>
