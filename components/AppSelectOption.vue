<script setup lang="ts">
import { SelectItem, SelectItemText, SelectItemIndicator } from "reka-ui";
import { Check } from "lucide-vue-next";
defineProps<{ value: string; disabled?: boolean }>();
</script>
<template>
  <SelectItem
    :value="value || '__empty__'"
    :disabled="disabled"
    class="select-option"
  >
    <SelectItemText><slot /></SelectItemText
    ><SelectItemIndicator><Check :size="16" aria-hidden="true" /></SelectItemIndicator>
  </SelectItem>
</template>
