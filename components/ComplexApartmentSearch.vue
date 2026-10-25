<script setup lang="ts">
import { Search } from 'lucide-vue-next';
import Button from '~/components/ui/button/Button.vue';

type Source = 'local' | 'nmarket' | 'rf39';
type Candidate = { id: string | number; layoutId?: number; preferredNmarketId?: string; matchedNmarketIds?: string[] };
type SearchResult = {
  candidates: Candidate[];
  matchedBy: string;
  warnings: string[];
  snapshotDate?: string;
  count?: number;
  linked?: number;
  conflicts?: number;
  existing?: number;
};
type SourceState = {
  status: 'idle' | 'searching' | 'waiting' | 'importing' | 'done' | 'stopped' | 'failed';
  total: number;
  processed: number;
  created: number;
  linked: number;
  existing: number;
  conflicts: number;
  errors: string[];
  warnings: string[];
  snapshotDate?: string;
  matchedBy?: string;
};
const props = defineProps<{ propertyId: string }>();
const emit = defineEmits<{ updated: [] }>();
const sources: { id: Source; label: string }[] = [
  { id: 'local', label: 'База сайта' },
  { id: 'nmarket', label: 'Нмаркет' },
  { id: 'rf39', label: 'CRM RF39' },
];
const emptyState = (): SourceState => ({
  status: 'idle', total: 0, processed: 0, created: 0, linked: 0, existing: 0, conflicts: 0,
  errors: [], warnings: [], snapshotDate: undefined, matchedBy: undefined,
});
const states = reactive<Record<Source, SourceState>>({ local: emptyState(), nmarket: emptyState(), rf39: emptyState() });
const snapshotMode = ref('live');
const preferredSource = ref<'nmarket' | 'rf39'>('nmarket');
const pending = ref(false);
const cancelled = ref(false);
const attempted = ref(false);
function errorMessage(error: any) {
  return error.data?.data?.message || error.data?.message || 'Источник временно недоступен. Повторите попытку.';
}
function statusText(state: SourceState) {
  if (state.status === 'searching') return 'Ищем квартиры…';
  if (state.status === 'waiting') return 'Ожидает обработки…';
  if (state.status === 'importing') return `Обработано ${state.processed} из ${state.total}`;
  if (state.status === 'stopped') return 'Остановлено';
  if (state.status === 'failed') return 'Не удалось загрузить';
  if (state.status === 'done') return state.errors.length ? 'Завершено с ошибками' : 'Готово';
  return 'Ожидает запуска';
}
function snapshotLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU', { timeZone: 'Europe/Kaliningrad' });
}
async function runSource(source: Source, propertyId: string, saved: boolean, rescan = false) {
  const state = states[source];
  state.status = 'searching';
  const snapshot = source !== 'local' && saved ? { snapshot: 'saved' as const } : {};
  let changed = false;
  try {
    const result = await $fetch<SearchResult>(`/api/admin/properties/${encodeURIComponent(propertyId)}/find-apartments`, {
      method: 'POST', body: { source, ...snapshot },
    });
    state.warnings = [...new Set(result.warnings || [])];
    state.snapshotDate = result.snapshotDate;
    state.matchedBy = result.matchedBy;
    state.total = result.count ?? result.candidates.length;
    if (source === 'local') {
      const previousLinked = rescan ? state.linked : 0;
      const newlyLinked = result.linked || 0;
      state.linked = previousLinked + newlyLinked;
      state.conflicts = result.conflicts || 0;
      state.existing = Math.max(0, (result.existing ?? state.total - newlyLinked - state.conflicts) - previousLinked);
      state.processed = state.total;
      changed = newlyLinked > 0;
      state.status = 'done';
      return result;
    }
    state.status = 'waiting';
    return result;
  } catch (error) {
    state.errors.push(errorMessage(error));
    state.status = 'failed';
    return null;
  } finally {
    if (changed) emit('updated');
  }
}
async function importCandidates(source: 'nmarket' | 'rf39', result: SearchResult, propertyId: string, saved: boolean, preference: 'nmarket' | 'rf39', crmMatches: Map<string, Candidate>) {
  const state = states[source];
  state.status = 'importing';
  // Successful searches may also save discovered source IDs, even when no apartment is created.
  let changed = true;
  try {
    for (const candidate of result.candidates) {
      if (cancelled.value) break;
      try {
        // A duplicate must keep the selected source even if its first import attempt failed.
        const crm = source === 'nmarket' && preference === 'rf39' ? crmMatches.get(String(candidate.id)) : undefined;
        const importSource = crm ? 'rf39' : source;
        const { id, layoutId, preferredNmarketId } = crm || candidate;
        const snapshot = saved ? importSource === 'nmarket' ? { snapshot: 'saved' as const } : { nmarketSnapshot: 'saved' as const } : {};
        const imported = await $fetch<{ id: string; created: boolean; linked: boolean; warnings: string[] }>(`/api/admin/${importSource}/import`, {
          method: 'POST', body: { id, layoutId, preferredNmarketId, complexId: propertyId, ...snapshot, ...(importSource === 'rf39' ? { preferredSource: preference } : {}) },
        });
        if (imported.created) state.created++;
        else if (imported.linked) state.linked++;
        else state.existing++;
        state.warnings = [...new Set([...state.warnings, ...(imported.warnings || [])])];
        if (imported.created || imported.linked) changed = true;
      } catch (error) {
        const label = candidate.layoutId == null ? candidate.id : `${candidate.id}, квартира ${candidate.layoutId}`;
        state.errors.push(`Объект ${label}: ${errorMessage(error)}`);
      } finally {
        state.processed++;
      }
    }
    state.status = state.processed < state.total && cancelled.value ? 'stopped' : 'done';
  } finally {
    if (changed) emit('updated');
  }
}
async function start() {
  if (pending.value) return;
  const propertyId = props.propertyId;
  const saved = snapshotMode.value === 'saved';
  const preference = preferredSource.value;
  cancelled.value = false;
  attempted.value = true;
  pending.value = true;
  for (const { id } of sources) Object.assign(states[id], emptyState());
  try {
    const completed = await Promise.all(sources.map(({ id }) => runSource(id, propertyId, saved)));
    // Existing site cards win; import new duplicates from the selected source first.
    const crmMatches = new Map((completed[2]?.candidates || []).flatMap(candidate =>
      (candidate.matchedNmarketIds || (candidate.preferredNmarketId ? [candidate.preferredNmarketId] : [])).map(id => [id, candidate] as const)));
    const order = preference === 'nmarket' ? [1, 2] : [2, 1];
    for (const index of order) if (completed[index])
      await importCandidates(sources[index]!.id as 'nmarket' | 'rf39', completed[index]!, propertyId, saved, preference, crmMatches);
    if (!cancelled.value && (completed[1] || completed[2])) {
      // Remote searches may discover IDs that identify older apartments already stored on the site.
      await runSource('local', propertyId, saved, true);
    }
  } finally {
    pending.value = false;
  }
}
onBeforeUnmount(() => { cancelled.value = true; });
</script>

<template>
  <div class="complex-search" data-testid="complex-apartment-search">
    <div class="complex-search-top">
      <div>
        <h3>Найти квартиры во всех базах</h3>
      </div>
      <label class="complex-search-mode">Данные Нмаркета
        <AppSelect v-model="snapshotMode" :disabled="pending" aria-label="Данные Нмаркета для поиска квартир">
          <AppSelectOption value="live">Свежая выгрузка</AppSelectOption>
          <AppSelectOption value="saved">Сохранённая выгрузка</AppSelectOption>
        </AppSelect>
      </label>
    </div>
    <div class="complex-search-preference">
      <p>Источник при дубле</p>
      <ImportSourceToggle v-model="preferredSource" :disabled="pending" label="Источник при совпадении квартиры" />
    </div>
    <p class="complex-search-hint">Перед поиском сохраните изменения объекта. Новые квартиры будут созданы черновиками.</p>
    <p v-if="snapshotMode === 'saved'" class="complex-search-warning">Сохранённая выгрузка может быть устаревшей. Проверьте цены и наличие перед публикацией.</p>
    <div class="complex-search-actions">
      <Button type="button" :disabled="pending" @click="start"><Search :size="17" aria-hidden="true" />{{ pending ? 'Ищем и привязываем…' : 'Найти и привязать квартиры' }}</Button>
      <button v-if="pending" type="button" class="btn-secondary" :disabled="cancelled" @click="cancelled = true">{{ cancelled ? 'Останавливаем…' : 'Остановить' }}</button>
    </div>
    <div v-if="attempted" class="complex-source-grid">
      <section v-for="source in sources" :key="source.id" class="complex-source" :data-source="source.id" :aria-label="source.label">
        <div class="complex-source-title"><h4>{{ source.label }}</h4><span :class="{ 'has-errors': states[source.id].errors.length }" role="status">{{ statusText(states[source.id]) }}</span></div>
        <p v-if="states[source.id].snapshotDate" class="complex-search-hint">Выгрузка от {{ snapshotLabel(states[source.id].snapshotDate!) }}</p>
        <p class="complex-source-total">Найдено: <strong>{{ states[source.id].total }}</strong></p>
        <dl class="complex-source-counts">
          <div><dt>Создано</dt><dd data-count="created">{{ states[source.id].created }}</dd></div>
          <div><dt>Привязано</dt><dd data-count="linked">{{ states[source.id].linked }}</dd></div>
          <div><dt>Уже были</dt><dd data-count="existing">{{ states[source.id].existing }}</dd></div>
          <div><dt>Ошибки</dt><dd data-count="errors">{{ states[source.id].errors.length }}</dd></div>
        </dl>
        <p v-if="states[source.id].conflicts" class="complex-search-warning">Уже связаны с другим ЖК: {{ states[source.id].conflicts }}. Эти связи сохранены.</p>
        <ul v-if="states[source.id].errors.length" class="complex-source-errors" role="alert"><li v-for="(error, index) in states[source.id].errors" :key="index">{{ error }}</li></ul>
        <details v-if="states[source.id].warnings.length" class="complex-source-warnings"><summary>Что проверить · {{ states[source.id].warnings.length }}</summary><ul><li v-for="warning in states[source.id].warnings" :key="warning">{{ warning }}</li></ul></details>
      </section>
    </div>
  </div>
</template>

<style scoped>
.complex-search { padding: 24px; border: 1px solid #dce5f2; border-radius: 14px; background: #f8faff; }
.complex-search-top { display: flex; align-items: start; justify-content: space-between; gap: 24px; }
.complex-search-top h3 { margin: 0 0 8px; color: #273d5e; font-size: 18px; font-weight: 700; }
.complex-search-mode { flex: 0 0 240px; font-size: 12px; color: #63738d; }
.complex-search-preference { margin-top: 20px; color: #63738d; font-size: 12px; }
.complex-search-preference p { margin-bottom: 8px; }
.complex-search-hint { margin-top: 12px; color: #63738d; font-size: 12px; line-height: 1.6; }
.complex-search-warning { margin-top: 12px; color: #8a5b13; font-size: 12px; line-height: 1.6; }
.complex-search-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 20px; }
.complex-source-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-top: 24px; }
.complex-source { min-width: 0; padding: 18px; border: 1px solid #e3e9f2; border-radius: 12px; background: white; }
.complex-source-title { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; }
.complex-source-title h4 { font-size: 15px; font-weight: 700; color: #273d5e; }
.complex-source-title span { color: #527097; font-size: 11px; }
.complex-source-title span.has-errors { color: #b3433a; }
.complex-source-total { margin: 18px 0 12px; color: #63738d; font-size: 12px; }
.complex-source-counts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.complex-source-counts dt { color: #63738d; font-size: 11px; }
.complex-source-counts dd { margin-top: 4px; color: #273d5e; font-size: 22px; font-weight: 700; }
.complex-source-errors { margin-top: 16px; padding-left: 16px; color: #b3433a; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; list-style: disc; }
.complex-source-warnings { margin-top: 16px; color: #63738d; font-size: 12px; line-height: 1.6; }
.complex-source-warnings summary { cursor: pointer; color: #345d96; }
.complex-source-warnings ul { padding: 8px 0 0 16px; list-style: disc; }
@media (max-width: 1050px) { .complex-source-grid { grid-template-columns: 1fr; } }
@media (max-width: 640px) { .complex-search { padding: 18px; } .complex-search-top { flex-direction: column; gap: 16px; } .complex-search-mode { flex: auto; width: 100%; } .complex-search-actions > button { width: 100%; } }
</style>
