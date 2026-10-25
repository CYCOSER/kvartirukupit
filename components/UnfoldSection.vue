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
let lastScroll = 0;
let navigating = false;
function syncScroll() {
  lastScroll = window.scrollY;
}
function resumeScroll() {
  navigating = false;
}
function navigateSection(event: Event) {
  const target = (event as CustomEvent<HTMLElement>).detail;
  if (!track.value || !enabled) return;
  navigating = true;
  const next = track.value.contains(target)
    ? "open"
    : track.value.compareDocumentPosition(target) &
        Node.DOCUMENT_POSITION_FOLLOWING
      ? "after"
      : "before";
  change(next, true);
  syncScroll();
}

function setHeight(height: number, keepBottom = false) {
  if (!track.value) return;
  const previous = track.value.getBoundingClientRect().bottom;
  track.value.style.height = `${height}px`;
  // Keep the following scene in place when removing content above the reader.
  if (keepBottom) {
    const delta = track.value.getBoundingClientRect().bottom - previous;
    const target = window.scrollY + delta + scrollRemainder;
    window.scrollTo({ top: target, behavior: "instant" });
    scrollRemainder = target - window.scrollY;
    window.dispatchEvent(new Event("unfold:resize"));
  }
}
function change(next: UnfoldState, instant = false) {
  if (!track.value || !content.value) return;
  cancelAnimationFrame(frame);
  scrollRemainder = 0;
  const keepBottom = state === "after" || next === "after";
  const from = track.value.getBoundingClientRect().height;
  const to = next === "open" ? content.value.offsetHeight : 0;
  state = next;
  if (instant || from === to) {
    setHeight(to, keepBottom);
    animating = false;
    return;
  }
  animating = true;
  const start = performance.now();
  function tick(time: number) {
    const progress = Math.min(1, (time - start) / 650);
    const eased = progress * progress * (3 - 2 * progress);
    setHeight(from + (to - from) * eased, keepBottom);
    if (progress < 1) frame = requestAnimationFrame(tick);
    else {
      animating = false;
      schedule();
    }
  }
  frame = requestAnimationFrame(tick);
}
function update() {
  scrollFrame = 0;
  const direction = Math.sign(window.scrollY - lastScroll);
  syncScroll();
  if (!enabled || navigating || animating || !track.value) return;
  // Keyboard users keep access to the section while a control has focus.
  if (track.value.querySelector(":focus-visible")) return;
  const { top, bottom } = track.value.getBoundingClientRect();
  const next = nextUnfoldState(
    state,
    top,
    bottom,
    window.innerHeight,
    direction,
  );
  if (next !== state) change(next);
}
function schedule() {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(update);
}
function measure() {
  if (!track.value || !content.value) return;
  enabled = !preference?.matches;
  if (!enabled) {
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
  change("open", true);
  event.target.scrollIntoView({ block: "center", behavior: "instant" });
}
onMounted(() => {
  preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  preference.addEventListener("change", measure);
  observer = new ResizeObserver(measure);
  if (content.value) observer.observe(content.value);
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", measure);
  window.addEventListener("unfold:resize", syncScroll);
  window.addEventListener("unfold:navigate", navigateSection);
  window.addEventListener("wheel", resumeScroll, { passive: true });
  window.addEventListener("touchstart", resumeScroll, { passive: true });
  window.addEventListener("keydown", resumeScroll);
  syncScroll();
  measure();
});
onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  cancelAnimationFrame(scrollFrame);
  observer?.disconnect();
  preference?.removeEventListener("change", measure);
  window.removeEventListener("scroll", schedule);
  window.removeEventListener("resize", measure);
  window.removeEventListener("unfold:resize", syncScroll);
  window.removeEventListener("unfold:navigate", navigateSection);
  window.removeEventListener("wheel", resumeScroll);
  window.removeEventListener("touchstart", resumeScroll);
  window.removeEventListener("keydown", resumeScroll);
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
