<script setup lang="ts">
import { Save, ShieldCheck, RotateCcw } from 'lucide-vue-next';
import Button from '~/components/ui/button/Button.vue';
import type { PrivacyPolicyVersion } from '~/shared/privacy-policy';

definePageMeta({ middleware: 'admin', layout: 'admin' });

const { data, error, refresh } = await useFetch<PrivacyPolicyVersion>('/api/admin/privacy-policy');
const saving = ref(false);
const notice = ref('');
const actionError = ref('');
const form = reactive({
  version: '',
  effectiveAt: '',
  summary: '',
});

let initialized = false;
watch(data, value => {
  if (!value || initialized) return;
  form.version = value.version || '';
  form.effectiveAt = value.effectiveAt || '';
  form.summary = value.summary || '';
  initialized = true;
}, { immediate: true });

const busy = computed(() => saving.value);

function message(cause: any) {
  return cause.data?.data?.message || cause.data?.message || 'Не удалось выполнить действие. Повторите попытку.';
}

async function save() {
  if (busy.value) return;
  actionError.value = '';
  notice.value = '';
  saving.value = true;
  try {
    const body: any = {};
    if (form.version.trim()) body.version = form.version.trim();
    if (form.effectiveAt) body.effectiveAt = new Date(form.effectiveAt).toISOString();
    if (form.summary.trim()) body.summary = form.summary.trim();
    const result = await $fetch<PrivacyPolicyVersion>('/api/admin/privacy-policy', {
      method: 'PUT',
      body,
      retry: 0,
    });
    data.value = result;
    notice.value = 'Версия политики обновлена. Все посетители увидят запрос нового согласия.';
  } catch (cause) {
    actionError.value = message(cause);
  } finally {
    saving.value = false;
  }
}

async function resetForm() {
  if (data.value) {
    form.version = data.value.version || '';
    form.effectiveAt = data.value.effectiveAt ? data.value.effectiveAt.slice(0, 16) : '';
    form.summary = data.value.summary || '';
    actionError.value = '';
    notice.value = '';
  }
}

function formatDate(value: string) {
  if (!value) return '—';
  return new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' мск';
}
</script>

<template>
  <div class="privacy-settings">
    <div class="admin-page-heading">
      <div>
        <h1 class="admin-title">Политика конфиденциальности</h1>
        <p class="admin-subtitle">Управление версией политики и согласиями посетителей.</p>
      </div>
    </div>

    <p v-if="error" class="error-text" role="alert">
      Не удалось загрузить версию политики.
      <button type="button" class="btn-secondary" @click="refresh()">Повторить загрузку</button>
    </p>

    <section class="admin-panel privacy-info">
      <div class="privacy-info-icon">
        <ShieldCheck :size="28" aria-hidden="true" />
      </div>
      <div class="privacy-info-text">
        <h2>Как это работает</h2>
        <p>
          При обновлении версии политики все посетители сайта увидят модальное окно
          с запросом нового согласия на обработку персональных данных и использование cookie.
          Старое согласие будет сброшено автоматически.
        </p>
        <p>
          Текущая версия: <strong>{{ data?.version || '—' }}</strong>
          <template v-if="data?.effectiveAt"> · Действует с {{ formatDate(data.effectiveAt) }}</template>
        </p>
      </div>
    </section>

    <form class="admin-panel privacy-form" @submit.prevent="save">
      <label>
        Версия политики
        <input
          v-model="form.version"
          aria-label="Версия политики"
          type="text"
          maxlength="64"
          :disabled="busy"
          placeholder="Например: 2026-11-25 или 2026-11-25-a1b2c3d4"
        />
        <small>
          Уникальный идентификатор версии. Можно использовать дату или хэш.
          Если оставить пустым — версия не изменится.
        </small>
      </label>

      <label>
        Дата вступления в силу
        <input
          v-model="form.effectiveAt"
          aria-label="Дата вступления в силу"
          type="datetime-local"
          :disabled="busy"
        />
        <small>Когда новая версия политики вступает в силу.</small>
      </label>

      <label>
        Краткое описание изменений
        <textarea
          v-model="form.summary"
          aria-label="Краткое описание изменений"
          maxlength="500"
          rows="3"
          :disabled="busy"
          placeholder="Например: Уточнены условия использования Яндекс.Метрики"
        />
        <small>Необязательно. Краткое описание того, что изменилось в политике.</small>
      </label>

      <div class="privacy-actions">
        <Button type="submit" :disabled="busy">
          <Save :size="16" aria-hidden="true" />
          {{ saving ? 'Сохраняем…' : 'Обновить версию и запросить согласие' }}
        </Button>
        <button type="button" class="btn-secondary" :disabled="busy" @click="resetForm">
          <RotateCcw :size="16" aria-hidden="true" />Сбросить форму
        </button>
      </div>

      <p v-if="notice" class="toast" role="status">{{ notice }}</p>
      <p v-if="actionError" class="error-text" role="alert">{{ actionError }}</p>
    </form>

    <section v-if="data" class="admin-panel privacy-current">
      <h2>Текущая версия</h2>
      <dl>
        <div>
          <dt>Версия</dt>
          <dd>{{ data.version }}</dd>
        </div>
        <div>
          <dt>Действует с</dt>
          <dd>{{ formatDate(data.effectiveAt) }}</dd>
        </div>
        <div v-if="data.summary">
          <dt>Описание</dt>
          <dd>{{ data.summary }}</dd>
        </div>
        <div v-if="data.updatedByName">
          <dt>Обновил</dt>
          <dd>{{ data.updatedByName }}</dd>
        </div>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.privacy-settings { max-width: 900px; }
.privacy-info { display: flex; gap: 20px; margin-bottom: 24px; }
.privacy-info-icon { flex-shrink: 0; width: 56px; height: 56px; border-radius: 50%; background: #e0e7ff; color: #4f46e5; display: grid; place-items: center; }
.privacy-info-text h2 { margin: 0 0 8px; font-size: 18px; font-weight: 700; color: #18355a; }
.privacy-info-text p { margin: 6px 0; color: #526473; font-size: 13px; line-height: 1.7; }
.privacy-info-text strong { color: #18355a; }

.privacy-form { display: grid; gap: 20px; }
.privacy-form > label { display: grid; gap: 8px; font-size: 13px; font-weight: 600; }
.privacy-form input,
.privacy-form textarea { width: 100%; padding: 11px 13px; border: 1px solid #dce5f2; border-radius: 8px; background: white; font: inherit; font-size: 14px; font-weight: 400; }
.privacy-form textarea { resize: vertical; min-height: 80px; }
.privacy-form input:disabled,
.privacy-form textarea:disabled { background: #f5f7fa; }
.privacy-form small, .privacy-form .error-text { color: #63738d; font-size: 12px; font-weight: 400; line-height: 1.6; }
.privacy-actions { display: flex; flex-wrap: wrap; gap: 12px; }

.privacy-current { margin-top: 24px; }
.privacy-current h2 { margin: 0 0 16px; font-size: 18px; font-weight: 700; color: #18355a; }
.privacy-current dl { display: grid; gap: 12px; margin: 0; }
.privacy-current dl > div { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding-bottom: 12px; border-bottom: 1px solid #eef2f7; }
.privacy-current dl > div:last-child { border-bottom: 0; padding-bottom: 0; }
.privacy-current dt { color: #63738d; font-size: 13px; min-width: 140px; }
.privacy-current dd { margin: 0; font-weight: 600; color: #18355a; }

@media (max-width: 640px) {
  .privacy-info { flex-direction: column; }
  .privacy-actions > button { width: 100%; }
  .privacy-current dl > div { flex-direction: column; gap: 4px; }
}
</style>