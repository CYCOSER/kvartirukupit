<script setup lang="ts">
import { ListChecks, Trash2 } from 'lucide-vue-next';

const userId = useState<string | null>('admin-user-id', () => null);
const { jobs, errors, panelOpen, refresh, remove } = useImportJobs();
const active = computed(() => jobs.value.filter(job => job.status === 'queued' || job.status === 'running'));
const expanded = ref<string[]>([]);
const deleting = ref<string | null>(null);
const deleteError = ref('');
let timer: ReturnType<typeof setTimeout>;
let disposed = false;
let polling = false;
async function poll() {
  clearTimeout(timer);
  if (!userId.value || disposed || polling) return;
  polling = true;
  try { await refresh(); }
  finally {
    polling = false;
    if (!disposed && userId.value) timer = setTimeout(poll, 2500);
  }
}
onMounted(() => { void poll(); });
watch(userId, () => { if (import.meta.client) void poll(); });
onBeforeUnmount(() => { disposed = true; clearTimeout(timer); });
function toggleDetail(id: string, event: Event) {
  const open = (event.target as HTMLDetailsElement).open;
  expanded.value = open ? [...new Set([...expanded.value, id])] : expanded.value.filter(value => value !== id);
}
async function removeJob(id: string) {
  if (deleting.value) return;
  deleting.value = id;
  deleteError.value = '';
  try {
    await remove(id);
    expanded.value = expanded.value.filter(value => value !== id);
  } catch (error: any) {
    deleteError.value = error.data?.data?.message || error.data?.message || 'Не удалось удалить задачу. Повторите попытку.';
  } finally { deleting.value = null; }
}
</script>

<template>
  <aside v-if="userId && (jobs.length || errors.list)" class="admin-jobs" aria-label="Фоновые задачи">
    <button type="button" class="jobs-toggle" :aria-expanded="panelOpen" aria-controls="admin-job-list" @click="panelOpen = !panelOpen"><ListChecks :size="20" aria-hidden="true" /><span>Фоновые задачи{{ active.length ? ' · выполняется ' + active.length : '' }}</span></button>
    <div v-if="panelOpen" id="admin-job-list" class="jobs-list">
      <p class="jobs-note">Задачи сохраняются на сервере. Остановка доступна здесь на любой странице.</p>
      <p v-if="errors.list" class="jobs-error" role="alert">{{ errors.list }} <button type="button" @click="refresh">Обновить</button></p>
      <p v-if="deleteError" class="jobs-error" role="alert">{{ deleteError }}</p>
      <details v-for="job in jobs" :key="job.id" class="jobs-entry" :data-job-id="job.id" @toggle="toggleDetail(job.id, $event)">
        <summary><button v-if="['completed', 'stopped', 'failed'].includes(job.status)" type="button" class="jobs-remove" :disabled="!!deleting" :aria-busy="deleting === job.id" aria-label="Удалить задачу из истории" title="Удалить задачу из истории. Созданные карточки сохранятся." @click.prevent.stop="removeJob(job.id)"><Trash2 :size="17" aria-hidden="true" /></button>{{ job.title }} · {{ job.processed }}/{{ job.total }}<span>{{ job.stopRequested && (job.status === 'queued' || job.status === 'running') ? 'Останавливаем…' : ({ queued: 'В очереди', running: 'Выполняется', completed: job.failed ? 'Завершено с ошибками' : 'Готово', stopped: 'Остановлено', failed: 'Ошибка' })[job.status] }}</span></summary>
        <ImportJobProgress v-if="expanded.includes(job.id)" :job-id="job.id" />
      </details>
    </div>
  </aside>
</template>

<style scoped>
.admin-jobs { position: fixed; z-index: 45; bottom: 16px; right: 16px; width: min(420px, calc(100vw - 32px)); border: 1px solid #cbd7e7; border-radius: 14px; background: #fff; box-shadow: 0 8px 30px #14283f26; color: #273d5e; font-size: 13px; line-height: 1.5; }
.jobs-toggle { display: flex; align-items: center; gap: 10px; padding: 14px 16px; width: 100%; text-align: left; font-weight: 700; cursor: pointer; }
.jobs-toggle:focus-visible, .jobs-remove:focus-visible, summary:focus-visible { outline: 2px solid #2867c6; outline-offset: 2px; }
.jobs-list { max-height: min(65vh, 640px); overflow-y: auto; padding: 0 14px 14px; overscroll-behavior: contain; }
.jobs-note { margin-bottom: 12px; color: #63738d; font-size: 12px; }
.jobs-entry { border-top: 1px solid #e3e9f2; padding: 10px 0; overflow-wrap: anywhere; }
.jobs-entry > summary { cursor: pointer; font-weight: 600; }
.jobs-entry > summary span { display: block; padding-left: 16px; font-weight: 400; color: #63738d; font-size: 12px; }
.jobs-entry > section { margin-top: 10px; }
.jobs-remove { float: right; display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; margin-left: 8px; border: 1px solid #dce5f2; border-radius: 8px; color: #63738d; cursor: pointer; }
.jobs-remove:hover { background: #fff3f2; color: #a33228; border-color: #ebc7c3; }
.jobs-remove:disabled { opacity: .5; cursor: default; }
.jobs-error { color: #a33228; margin: 10px 0; }
.jobs-error button { text-decoration: underline; }
</style>
