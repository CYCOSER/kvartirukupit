<script setup lang="ts" generic="T extends string | number | null">
import { ChevronUp, ChevronDown } from "lucide-vue-next";
defineOptions({ inheritAttrs: false });
const props = defineProps<{
  modelValue: T;
  increment: number;
  min?: number | string;
  max?: number | string;
  numeric?: boolean;
  nullable?: boolean;
  controlLabel: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: T] }>();
function set(value: string) {
  emit(
    "update:modelValue",
    (props.numeric
      ? value === "" && props.nullable
        ? null
        : value === ""
          ? ""
          : Number(value)
      : value) as T,
  );
}
function step(direction: number) {
  const current = Number(props.modelValue || 0);
  const next = Math.min(
    Number(props.max ?? Infinity),
    Math.max(
      Number(props.min ?? -Infinity),
      current + direction * props.increment,
    ),
  );
  set(String(Number(next.toFixed(6))));
}
</script>
<template>
  <div class="number-field">
    <input
      v-bind="$attrs"
      type="number"
      step="any"
      :min="min"
      :max="max"
      :value="modelValue ?? ''"
      @input="set(($event.target as HTMLInputElement).value)"
      @keydown.up.prevent="step(1)"
      @keydown.down.prevent="step(-1)"
    />
    <div class="number-steppers">
      <button
        type="button"
        :aria-label="'Увеличить ' + controlLabel"
        @click.prevent="step(1)"
      >
        <ChevronUp :size="14" />
      </button>
      <button
        type="button"
        :aria-label="'Уменьшить ' + controlLabel"
        @click.prevent="step(-1)"
      >
        <ChevronDown :size="14" />
      </button>
    </div>
  </div>
</template>
