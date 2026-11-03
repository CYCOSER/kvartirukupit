<script setup lang="ts">
import type { ImportJobView } from '~/shared/import-job';

const props = withDefaults(defineProps<{ jobId: string; expanded?: boolean }>(), { expanded: true });
const { jobs, details, errors, load, stop, retry } = useImportJobs();
const summary = computed(() => jobs.value.find(job => job.id === props.jobId));
const job = computed(() => summary.value || details.value[props.jobId]);
const items = computed(() => details.value[props.jobId]?.items || []);
const failures = computed(() => items.value.filter(item => item.error));
const results = computed(() => items.value.filter(item => item.kind === 'import' && item.propertyId));
const notices = computed(() => [...new Set(items.value.flatMap(item => item.warnings))]);
const pending = ref(false);
const actionError = ref('');
const retryId = ref('');
watch(() => props.jobId, () => { retryId.value = ''; actionError.value = ''; });
const active = computed(() => job.value?.status === 'queued' || job.value?.status === 'running');
function statusText(value: ImportJobView) {
  if (active.value && value.stopRequested) return 'Останавливаем…';
  if (value.status === 'queued') return 'В очереди';
  if (value.status === 'running') return 'Выполняется';
  if (value.status === 'stopped') return 'Остановлено';
  if (value.status === 'failed') return 'Не удалось завершить';
  return value.failed ? 'Завершено с ошибками' : 'Готово';
}
watch(() => [props.jobId, summary.value?.updatedAt, props.expanded], () => {
  if (import.meta.client && props.expanded) void load(props.jobId);
}, { immediate: true });
async function act(action: 'stop' | 'retry') {
  pending.value = true;
  actionError.value = '';
  try {
    if (action === 'stop') await stop(props.jobId);
    else {
      retryId.value ||= crypto.randomUUID();
      await retry(props.jobId, retryId.value);
      retryId.value = '';
    }
  } catch (error: any) {
    actionError.value = error.data?.data?.message || error.data?.message || 'Не удалось выполнить действие. Повторите попытку.';
  } finally { pending.value = false; }
}
</script>

<template>
  <section v-if="job" class="job-progress" :data-job-id="job.id" :aria-label="job.title">
    <div class="job-heading"><strong>{{ job.title }}</strong><span role="status">{{ statusText(job) }}</span></div>
    <div class="import-progress" role="status" aria-live="polite">
      <span>Обработано: {{ job.processed }} из {{ job.total }}{{ job.activeTitle ? ' · ' + job.activeTitle : '' }}</span>
      <p>Создано: {{ job.created }} · Уже добавлены: {{ job.existing }} · Пропущено: {{ job.failed }}</p>
      <p v-if="job.kind === 'apartments'">Привязано: {{ job.linked }} · ЖК в задании: {{ job.complexIds?.length || 0 }}</p>
      <progress :value="job.processed" :max="Math.max(1, job.total)" aria-label="Ход импорта" />
    </div>
    <div class="job-actions">
      <button v-if="active" type="button" class="job-button" :disabled="pending || job.stopRequested" @click="act('stop')">{{ job.stopRequested ? 'Останавливаем…' : 'Остановить' }}</button>
      <button v-else-if="job.canRetry" type="button" class="job-button" :disabled="pending" @click="act('retry')">Повторить незавершённые</button>
    </div>
    <p v-if="active" class="job-note">{{ job.stopRequested ? 'Завершаем текущую операцию. Следующие объекты обрабатываться не будут.' : 'Можно перейти на другую страницу или закрыть вкладку. Задача продолжится на сервере.' }}</p>
    <p v-if="job.error || actionError" class="import-error" role="alert">{{ actionError || job.error }}</p>
    <template v-if="expanded">
      <p v-if="errors[jobId]" class="import-error" role="alert">{{ errors[jobId] }} <button type="button" class="job-button" @click="load(jobId, true)">Обновить</button></p>
      <div v-if="failures.length" class="import-error" role="alert">
        <p>Пропущено: {{ job.failed }}. Неудачные операции можно повторить.</p>
        <ul><li v-for="item in failures" :key="item.id">{{ item.complexTitle ? item.complexTitle + ' · ' : '' }}{{ item.title }}{{ item.sourceId != null ? ' (ID ' + item.sourceId + ')' : '' }}: {{ item.error }}</li></ul>
      </div>
      <details v-if="notices.length" class="job-warnings"><summary>Что проверить · {{ notices.length }}</summary><ul><li v-for="notice in notices" :key="notice">{{ notice }}</li></ul></details>
      <details v-if="results.length" class="import-results">
        <summary>Результаты импорта · {{ results.length }}</summary>
        <ul><li v-for="result in results" :key="result.id"><NuxtLink :to="'/admin-console-9Xk6uiIs/properties/' + result.propertyId">{{ result.title }} — {{ result.created ? 'открыть черновик' : 'уже добавлен, открыть' }}</NuxtLink></li></ul>
      </details>
    </template>
  </section>
</template>

<style scoped>
.job-progress { min-width: 0; padding: 18px; border: 1px solid #dce5f2; border-radius: 12px; background: #fff; color: #273d5e; font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.job-heading { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; }
.job-heading > span { color: #526b8c; font-size: 12px; }
.import-progress { margin-top: 12px; }
progress { display: block; width: 100%; height: 8px; margin: 10px 0; accent-color: #2867c6; }
.job-actions { display: flex; gap: 8px; margin-top: 12px; }
.job-button { border: 1px solid #cbd7e7; padding: 6px 12px; border-radius: 8px; background: #fff; color: #273d5e; cursor: pointer; }
.job-button:disabled { opacity: .6; cursor: default; }
.job-button:focus-visible, summary:focus-visible { outline: 2px solid #2867c6; outline-offset: 3px; }
.job-note { margin-top: 10px; color: #63738d; font-size: 12px; }
.import-error { margin-top: 12px; color: #a33228; }
.job-warnings, .import-results { margin-top: 12px; }
summary { cursor: pointer; font-weight: 600; }
ul { margin: 8px 0 0; padding-left: 20px; list-style: disc; max-height: 280px; overflow: auto; }
a { color: #245fbd; text-decoration: underline; }
</style>
