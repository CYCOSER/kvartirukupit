<script setup lang="ts">
import { Search } from 'lucide-vue-next';
import Button from '~/components/ui/button/Button.vue';

const props = defineProps<{
  propertyId?: string;
  properties?: { id: string; title: string }[];
  disabled?: boolean;
}>();
const emit = defineEmits<{ updated: []; finished: [] }>();
const { jobs, start } = useImportJobs();
const targetIds = computed(() => props.propertyId
  ? [props.propertyId]
  : [...new Set((props.properties || []).map(property => property.id))]);
const relevantJobs = computed(() => jobs.value.filter(job => job.kind === 'apartments' &&
  job.complexIds?.some(id => targetIds.value.includes(id))));
const activeJob = computed(() => relevantJobs.value.find(job => job.status === 'queued' || job.status === 'running'));
const job = computed(() => activeJob.value || relevantJobs.value[0]);
const snapshotMode = ref('live');
const preferredSource = ref<'nmarket' | 'rf39'>('nmarket');
const starting = ref(false);
const error = ref('');
const pending = computed(() => starting.value || !!activeJob.value);
let requestKey = '';
let requestId = '';

watch(() => job.value?.updatedAt, (value, previous) => {
  if (value && value !== previous) emit('updated');
});
watch(() => activeJob.value?.id, (value, previous) => {
  if (activeJob.value) {
    snapshotMode.value = activeJob.value.snapshot || 'live';
    preferredSource.value = activeJob.value.preferredSource || 'nmarket';
  }
  if (previous && !value) emit('finished');
}, { immediate: true });

async function launch() {
  if (pending.value || props.disabled || !targetIds.value.length) return;
  const input = {
    kind: 'apartments' as const,
    complexIds: [...targetIds.value],
    preferredSource: preferredSource.value,
    ...(snapshotMode.value === 'saved' ? { snapshot: 'saved' as const } : {}),
  };
  const key = JSON.stringify(input);
  // Retry an uncertain response with the same ID so a lost response cannot queue duplicates.
  if (key !== requestKey) {
    requestKey = key;
    requestId = crypto.randomUUID();
  }
  starting.value = true;
  error.value = '';
  try {
    await start({ ...input, requestId });
    requestKey = '';
  } catch (cause: any) {
    error.value = cause.data?.data?.message || cause.data?.message || 'Не удалось запустить поиск. Повторите попытку.';
  } finally {
    starting.value = false;
  }
}
</script>

<template>
  <div class="complex-search" data-testid="complex-apartment-search">
    <div class="complex-search-top">
      <h3>Найти квартиры во всех базах</h3>
      <label class="complex-search-mode">Данные Нмаркета и CRM RF39
        <AppSelect v-model="snapshotMode" :disabled="pending || disabled" aria-label="Данные Нмаркета и CRM RF39 для поиска квартир">
          <AppSelectOption value="live">Свежая выгрузка</AppSelectOption>
          <AppSelectOption value="saved">Сохранённая выгрузка</AppSelectOption>
        </AppSelect>
      </label>
    </div>
    <div class="complex-search-preference">
      <p>Источник при дубле</p>
      <ImportSourceToggle v-model="preferredSource" :disabled="pending || disabled" label="Источник при совпадении квартиры" />
    </div>
    <p v-if="propertyId" class="complex-search-hint">Перед поиском сохраните изменения объекта.</p>
    <p v-else class="complex-search-hint">Выбранные ЖК будут обработаны по очереди: база сайта, Нмаркет и CRM RF39.</p>
    <p class="complex-search-hint">Квартиры из Нмаркета сохраняются черновиками, из XML CRM RF39 — сразу публикуются в каталоге «Квартиры с ремонтом».</p>
    <p class="complex-search-hint">Поиск продолжится при переходе на другую страницу и после закрытия вкладки. Его можно остановить в панели задач.</p>
    <p v-if="snapshotMode === 'saved'" class="complex-search-warning">Сохранённая выгрузка может быть устаревшей. Проверьте цены и наличие.</p>
    <div class="complex-search-actions">
      <Button type="button" :disabled="pending || disabled || !targetIds.length" @click="launch">
        <Search :size="17" aria-hidden="true" />{{ starting ? 'Запускаем…' : activeJob ? 'Поиск выполняется…' : propertyId ? 'Найти и привязать квартиры' : `Найти квартиры для выбранных ЖК (${targetIds.length})` }}
      </Button>
    </div>
    <p v-if="error" class="complex-search-error" role="alert">{{ error }}</p>
    <ImportJobProgress v-if="job" :job-id="job.id" />
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
.complex-search-error { margin-top: 12px; color: #b3433a; font-size: 12px; line-height: 1.6; }
.complex-search-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 20px 0; }
@media (max-width: 640px) { .complex-search { padding: 18px; } .complex-search-top { flex-direction: column; gap: 16px; } .complex-search-mode { flex: auto; width: 100%; } .complex-search-actions > button { width: 100%; } }
</style>
