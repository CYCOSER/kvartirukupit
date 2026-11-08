<script setup lang="ts">
import { RefreshCw, Save } from 'lucide-vue-next';
import Button from '~/components/ui/button/Button.vue';
import { feedSyncInputSchema, type FeedSyncSettings } from '~/shared/feed-sync';
import type { ImportJobView } from '~/shared/import-job';

definePageMeta({ middleware: 'admin', layout: 'admin' });
const { data, error, refresh } = await useFetch<FeedSyncSettings>('/api/admin/feed-sync');
const form = reactive(feedSyncInputSchema.parse({}));
const jobs = useImportJobs();
const saving = ref(false), starting = ref(false), notice = ref(''), actionError = ref('');
let initialized = false;
let requestId = '';
watch(data, value => {
  if (!value || initialized) return;
  Object.assign(form, { url: value.url, enabled: value.enabled, intervalMinutes: value.intervalMinutes });
  initialized = true;
}, { immediate: true });
const dirty = computed(() => !!data.value && (form.url.trim() !== data.value.url ||
  form.enabled !== data.value.enabled || form.intervalMinutes !== data.value.intervalMinutes));
const jobId = computed(() => data.value?.activeJobId || data.value?.lastJobId);
const active = computed(() => !!data.value?.activeJobId);
const busy = computed(() => saving.value || starting.value);
function date(value: string | null) {
  return value ? new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' мск' : '—';
}
function message(cause: any) {
  return cause.data?.data?.message || cause.data?.message || 'Не удалось выполнить действие. Повторите попытку.';
}
async function save() {
  if (busy.value || !data.value) return;
  actionError.value = '';
  notice.value = '';
  const parsed = feedSyncInputSchema.safeParse(form);
  if (!parsed.success) {
    actionError.value = 'Укажите ссылку вида https://feed.rf39.ru/30.xml и целый интервал от 15 до 10080 минут.';
    return;
  }
  saving.value = true;
  try {
    data.value = await $fetch<FeedSyncSettings>('/api/admin/feed-sync', { method: 'PUT', body: parsed.data, retry: 0 });
    Object.assign(form, { url: data.value.url, enabled: data.value.enabled, intervalMinutes: data.value.intervalMinutes });
    requestId = '';
    notice.value = data.value.enabled ? 'Настройки сохранены. Автоматическая синхронизация включена.' : 'Настройки сохранены. Автоматическая синхронизация выключена.';
  } catch (cause) { actionError.value = message(cause); }
  finally { saving.value = false; }
}
async function run() {
  if (busy.value || active.value || dirty.value || !data.value) return;
  starting.value = true;
  actionError.value = '';
  notice.value = '';
  requestId ||= crypto.randomUUID();
  try {
    const job = await $fetch<ImportJobView>('/api/admin/feed-sync/run', { method: 'POST', body: { requestId }, retry: 0 });
    requestId = '';
    data.value = { ...data.value, lastJobId: job.id, activeJobId: ['queued', 'running'].includes(job.status) ? job.id : null };
    jobs.panelOpen.value = true;
    await jobs.refresh();
    await refresh();
    notice.value = 'Синхронизация запущена. Можно закрыть страницу.';
  } catch (cause) { actionError.value = message(cause); }
  finally { starting.value = false; }
}
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => { timer = setInterval(() => { if (!busy.value) void refresh(); }, 10000); });
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <div class="feed-settings">
    <div class="admin-page-heading">
      <div><h1 class="admin-title">XML-выгрузка CRM RF39</h1>
        <p class="admin-subtitle">Автоматическое обновление квартир по выгрузке CRM.</p></div>
    </div>
    <p v-if="error" class="error-text" role="alert">Не удалось загрузить настройки. <button type="button" class="btn-secondary" @click="refresh()">Повторить загрузку</button></p>
    <form class="admin-panel feed-form" @submit.prevent="save">
      <label>Ссылка XML
        <input v-model="form.url" aria-label="Ссылка XML" type="url" required maxlength="300" :disabled="!data || busy" placeholder="https://feed.rf39.ru/30.xml" />
      </label>
      <label>Интервал обновления, минут
        <input v-model.number="form.intervalMinutes" aria-label="Интервал обновления, минут" type="number" min="15" max="10080" step="1" required :disabled="!data || busy" />
        <small>От 15 минут до 7 дней. По умолчанию — каждый час.</small>
      </label>
      <label class="feed-enabled"><input v-model="form.enabled" type="checkbox" :disabled="!data || busy" /> Автоматически обновлять по расписанию</label>
      <p class="feed-hint">Расписание работает на сервере, даже если вы закроете вкладку. Выключение расписания не останавливает текущую задачу — используйте кнопку «Остановить» в её результатах.</p>
      <div class="feed-actions">
        <Button type="submit" :disabled="!data || busy || !dirty"><Save :size="16" aria-hidden="true" />{{ saving ? 'Сохраняем…' : 'Сохранить настройки' }}</Button>
        <button type="button" class="btn-secondary" :disabled="!data || busy || dirty || active" @click="run"><RefreshCw :size="16" aria-hidden="true" />{{ starting ? 'Запускаем…' : active ? 'Синхронизация выполняется…' : 'Синхронизировать сейчас' }}</button>
      </div>
      <p v-if="dirty" class="feed-hint">Сохраните изменения перед запуском синхронизации.</p>
      <p v-if="notice" class="toast" role="status">{{ notice }}</p>
      <p v-if="actionError" class="error-text" role="alert">{{ actionError }}</p>
    </form>
    <section class="admin-panel feed-rules" aria-label="Правила синхронизации">
      <h2>Как обновляются карточки</h2>
      <ul>
        <li>Из XML загружаются только квартиры. Квартиры из выгрузки публикуются в каталоге «Квартиры с ремонтом».</li>
        <li>Квартиры с основным источником CRM RF39, которых больше нет в выгрузке, снимаются с публикации.</li>
        <li>Ручные правки карточек и фотографии сохраняются.</li>
        <li>Если выгрузка недоступна или содержит ошибку, карточки не снимаются с публикации.</li>
      </ul>
    </section>
    <section v-if="data" class="admin-panel feed-history" aria-label="Состояние синхронизации">
      <dl><div><dt>Расписание</dt><dd>{{ data.enabled ? 'Включено' : 'Выключено' }}</dd></div>
        <div><dt>Следующий запуск</dt><dd>{{ date(data.nextRunAt) }}</dd></div>
        <div><dt>Последняя успешная синхронизация</dt><dd>{{ date(data.lastSuccessAt) }}</dd></div></dl>
      <p v-if="data.lastError" class="error-text" role="alert">{{ data.lastError }}</p>
    </section>
    <ImportJobProgress v-if="jobId" :job-id="jobId" />
  </div>
</template>

<style scoped>
.feed-settings { max-width: 1000px; }
.feed-form { display: grid; gap: 20px; }
.feed-form > label { display: grid; gap: 8px; font-size: 13px; font-weight: 600; }
.feed-form input:not([type="checkbox"]) { width: 100%; padding: 11px 13px; border: 1px solid #dce5f2; border-radius: 8px; background: white; font-size: 14px; }
.feed-form small, .feed-hint { color: #63738d; font-size: 12px; font-weight: 400; line-height: 1.6; }
.feed-form > .feed-enabled { display: flex; align-items: center; gap: 10px; }
.feed-enabled input { width: 18px; height: 18px; flex-shrink: 0; }
.feed-actions { display: flex; flex-wrap: wrap; gap: 12px; }
.feed-actions > button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
.feed-rules, .feed-history { margin: 24px 0; }
.feed-rules h2 { margin-bottom: 12px; font-size: 18px; line-height: 1.4; font-weight: 700; }
.feed-rules ul { padding-left: 20px; list-style: disc; color: #526473; font-size: 13px; line-height: 1.8; }
.feed-history dl { display: grid; gap: 12px; }
.feed-history dl > div { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; font-size: 13px; }
.feed-history dt { color: #63738d; }
.feed-history dd { font-weight: 600; }
.feed-history .error-text { margin-top: 16px; }
@media (max-width: 640px) { .feed-actions > button { width: 100%; } }
</style>
