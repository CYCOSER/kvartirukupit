<script setup lang="ts">
const config = useRuntimeConfig();
const parts = computed(() =>
  config.public.siteName.split("—").map((part) => part.trim()),
);
</script>

<template>
  <span class="brand-name" :aria-label="config.public.siteName">
    <template v-if="parts.length === 2"
      >{{ parts[0] }}<span class="brand-dash" aria-hidden="true"> — </span
      >{{ parts[1] }}</template
    >
    <template v-else>{{ config.public.siteName }}</template>
  </span>
</template>
