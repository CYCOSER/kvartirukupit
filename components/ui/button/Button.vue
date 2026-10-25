<script setup lang="ts">
import { Primitive, type PrimitiveProps } from "reka-ui";
import { cn } from "~/lib/utils";
const props = withDefaults(
  defineProps<
    PrimitiveProps & {
      class?: string;
    }
  >(),
  { as: "button" },
);
</script>
<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    :class="
      cn(
        'inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-50 disabled:pointer-events-none bg-accent text-white hover:bg-[#245fbd]',
        props.class,
      )
    "
    ><slot
  /></Primitive>
</template>
