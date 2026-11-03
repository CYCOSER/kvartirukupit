<script setup lang="ts">
import { X } from 'lucide-vue-next';
import { emptyAdminExclusions, type AdminExclusions, type AdminExclusionField } from '~/shared/admin-exclusions';

defineProps<{ fields: AdminExclusionField[]; textHint: string }>();
const model = defineModel<AdminExclusions>({ required: true });
const picked = reactive<Record<string, string>>({});
const count = computed(() => Object.values(model.value.values).reduce((sum, values) => sum + values.length, 0) +
  model.value.text.split(/[;\r\n]+/).filter(value => value.trim()).length);

async function add(key: string, value: string) {
  if (!value) return;
  model.value = { ...model.value, values: { ...model.value.values,
    [key]: [...new Set([...(model.value.values[key] || []), value])],
  } };
  await nextTick();
  picked[key] = '';
}
function remove(key: string, value: string) {
  model.value = { ...model.value, values: { ...model.value.values,
    [key]: (model.value.values[key] || []).filter(item => item !== value),
  } };
}
</script>

<template>
  <details class="admin-exclusions" :class="{ 'has-exclusions': count > 0 }">
    <summary>Исключения<span v-if="count"> · {{ count }}</span></summary>
    <div class="exclusions-heading">
      <p>Скрыть записи с любым из выбранных значений или фраз.</p>
      <button v-if="count" type="button" class="exclusions-reset" @click="model = emptyAdminExclusions()">Сбросить исключения</button>
    </div>
    <label class="exclusions-text">Исключить по тексту
      <textarea v-model="model.text" aria-label="Исключить по тексту" rows="2" placeholder="По одной фразе на строку или через ;" />
      <small>{{ textHint }} Регистр не учитывается.</small>
    </label>
    <div class="exclusions-grid">
      <div v-for="field in fields" :key="field.key" class="exclusions-field">
        <label>{{ field.label }}
          <AppSelect v-model="picked[field.key]" :aria-label="`Исключить: ${field.label}`" @change="add(field.key, $event)">
            <AppSelectOption value="">Добавить исключение</AppSelectOption>
            <AppSelectOption v-for="option in field.options" :key="option.value" :value="option.value" :disabled="model.values[field.key]?.includes(option.value)">
              {{ option.label }}
            </AppSelectOption>
          </AppSelect>
        </label>
        <ul v-if="model.values[field.key]?.length" class="exclusions-chips" :aria-label="`Исключено: ${field.label}`">
          <li v-for="value in model.values[field.key]" :key="value">
            <button type="button" :aria-label="`Убрать исключение: ${field.label} — ${field.options.find(option => option.value === value)?.label || value}`" @click="remove(field.key, value)">
              {{ field.options.find(option => option.value === value)?.label || value }}<X :size="13" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </div>
    </div>
  </details>
</template>

<style scoped>
.admin-exclusions { margin: 20px 0; padding: 16px; border: 1px solid #dce5f2; border-radius: 10px; background: #f8faff; }
.admin-exclusions.has-exclusions { border-color: #a9bfdf; }
summary { cursor: pointer; color: #36557e; font-size: 13px; font-weight: 600; }
.exclusions-heading { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 8px 16px; margin: 14px 0; color: #63738d; font-size: 12px; }
.exclusions-reset { color: #245fbd; text-decoration: underline; text-underline-offset: 3px; }
.exclusions-text, .exclusions-field label { display: grid; gap: 8px; min-width: 0; }
.exclusions-text textarea { width: 100%; min-height: 64px; padding: 10px 12px; border: 1px solid #dce5f2; background: white; resize: vertical; font-size: 13px; }
.exclusions-text small { color: #63738d; font-weight: 400; line-height: 1.6; }
.exclusions-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); gap: 16px; margin-top: 16px; }
.exclusions-field { min-width: 0; }
.exclusions-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 0; padding: 0; list-style: none; }
.exclusions-chips li { max-width: 100%; }
.exclusions-chips button { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; border: 1px solid #c9d8ed; border-radius: 6px; padding: 5px 8px; background: #eef3fb; color: #36557e; text-align: left; font-size: 11px; overflow-wrap: anywhere; }
.exclusions-chips svg { flex-shrink: 0; }
.exclusions-chips button:hover { background: #e1eaf8; }
button:focus-visible, summary:focus-visible { outline: 2px solid #91b2e5; outline-offset: 3px; }
</style>
