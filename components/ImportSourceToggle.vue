<script setup lang="ts">
import { Building2, Database } from 'lucide-vue-next';
defineProps<{ modelValue: 'nmarket' | 'rf39'; disabled?: boolean; label?: string }>();
defineEmits<{ 'update:modelValue': [value: 'nmarket' | 'rf39'] }>();
</script>

<template>
  <nav class="import-sources" :class="{ 'is-nmarket': modelValue === 'nmarket' }" :aria-label="label || 'Источник импорта'">
    <span class="import-source-indicator" aria-hidden="true"></span>
    <button type="button" :aria-pressed="modelValue === 'rf39'" :disabled="disabled" @click="$emit('update:modelValue', 'rf39')"><Database :size="18" /> CRM RF39</button>
    <button type="button" :aria-pressed="modelValue === 'nmarket'" :disabled="disabled" @click="$emit('update:modelValue', 'nmarket')"><Building2 :size="18" /> Нмаркет</button>
  </nav>
</template>

<style scoped>
.import-sources { position: relative; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 292px; max-width: 100%; padding: 3px; border: 1px solid #dbe4ef; border-radius: 8px; background: #e9eef4; margin-bottom: 20px; }
.import-source-indicator { position: absolute; top: 3px; bottom: 3px; left: 3px; width: calc((100% - 6px) / 2); border-radius: 5px; background: #fff; box-shadow: 0 1px 4px #16325212; pointer-events: none; transition: transform 260ms cubic-bezier(.22, .68, .3, 1); }
.import-sources.is-nmarket .import-source-indicator { transform: translateX(100%); }
.import-sources button { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 38px; padding: 8px 12px; border-radius: 5px; font-size: 13px; font-weight: 600; color: #6a7c91; background: transparent; transition: color 160ms; }
.import-sources button[aria-pressed="true"], .import-sources button:hover { color: #173a60; }
.import-sources button:focus-visible { outline: 2px solid #245bc1; outline-offset: 2px; }
.import-sources button:disabled { cursor: wait; }
@media (prefers-reduced-motion: reduce) { .import-source-indicator, .import-sources button { transition: none; } }
@media (max-width: 640px) { .import-sources { width: 100%; } .import-sources button { flex: 1; justify-content: center; padding: 10px 12px; } }
</style>
