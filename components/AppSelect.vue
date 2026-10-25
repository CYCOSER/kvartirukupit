<script setup lang="ts" generic="T extends string">
import {
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectIcon,
  SelectPortal,
  SelectContent,
  SelectViewport,
} from "reka-ui";
import { ChevronDown } from "lucide-vue-next";
defineOptions({ inheritAttrs: false });
const props = defineProps<{ modelValue?: T; value?: T; disabled?: boolean }>();
const emit = defineEmits<{
  "update:modelValue": [value: T];
  change: [value: T];
}>();
const open = ref(false);
const trigger = ref<InstanceType<typeof SelectTrigger>>();
const side = ref("bottom");
const panelStyle = ref<Record<string, string>>({});
watch(open, async (isOpen, _, onCleanup) => {
  if (!isOpen) return;
  const field = trigger.value?.$el as HTMLElement | undefined;
  if (!field) return;
  const styles = getComputedStyle(field);
  // The portal keeps the field's palette and corners without inheriting page layout.
  panelStyle.value = Object.fromEntries([
    "--select-surface", "--select-ink", "--select-active-border",
    "--select-selected", "--select-highlight",
  ].map((name) => [name, styles.getPropertyValue(name)]));
  panelStyle.value["--select-radius"] = styles.borderTopLeftRadius;
  let cancelled = false;
  let observer: MutationObserver | undefined;
  onCleanup(() => { cancelled = true; observer?.disconnect(); });
  await nextTick();
  if (cancelled) return;
  const panel = document.getElementById(field.getAttribute("aria-controls") || "");
  if (!panel) return;
  const updateSide = () => { side.value = panel.dataset.side === "top" ? "top" : "bottom"; };
  updateSide();
  observer = new MutationObserver(updateSide);
  observer.observe(panel, { attributes: true, attributeFilter: ["data-side"] });
}, { flush: "sync" });
const selected = computed(
  () => (props.modelValue ?? props.value) || "__empty__",
);
function update(value: unknown) {
  const next = (value === "__empty__" ? "" : String(value)) as T;
  emit("update:modelValue", next);
  emit("change", next);
}
</script>
<template>
  <SelectRoot
    :model-value="selected"
    :disabled="disabled"
    v-model:open="open"
    @update:model-value="update"
  >
    <SelectTrigger
      ref="trigger"
      v-bind="$attrs"
      class="select-field"
      :class="{ 'select-field-open': open }"
      :data-side="open ? side : undefined"
      :style="{ '--select-radius': panelStyle['--select-radius'] }"
    >
      <SelectValue placeholder="Выберите значение" /><SelectIcon
        ><ChevronDown :size="17" aria-hidden="true"
      /></SelectIcon>
    </SelectTrigger>
    <SelectPortal>
      <SelectContent
        position="popper"
        side="bottom"
        align="start"
        :side-offset="0"
        :collision-padding="8"
        :body-lock="false"
        class="select-panel"
        :style="panelStyle"
      >
        <SelectViewport class="select-options"><slot /></SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
