<script setup lang="ts">
import { Copy, Eye, EyeOff } from 'lucide-vue-next';

definePageMeta({ middleware: 'admin', layout: 'admin' });
const siteUrl = useRuntimeConfig().public.siteUrl.replace(/\/$/, '');
const baseUrl = `${siteUrl}/api/agent/v1`;
const schemaUrl = `${siteUrl}/agent-openapi.json`;
const { data, error, refresh } = await useFetch('/api/admin/agent-connection');
const key = ref<string | null>(null);
const busy = ref(false), notice = ref(''), actionError = ref('');

async function accessKey(copy = false) {
  busy.value = true;
  notice.value = '';
  actionError.value = '';
  try {
    const connection = await $fetch('/api/admin/agent-connection', { query: { reveal: '1' }, retry: 0 });
    if (!connection.token) {
      data.value = connection;
      key.value = null;
      actionError.value = 'API не настроен. Укажите ключ на сервере.';
      return;
    }
    if (copy) {
      if (!navigator.clipboard) {
        actionError.value = 'Буфер обмена недоступен. Нажмите «Показать ключ» и скопируйте его вручную.';
        return;
      }
      await navigator.clipboard.writeText(connection.token);
      notice.value = 'Ключ скопирован.';
    } else key.value = connection.token;
  } catch {
    actionError.value = copy
      ? 'Не удалось скопировать ключ. Повторите попытку или покажите ключ и скопируйте его вручную.'
      : 'Не удалось получить ключ. Проверьте подключение и повторите попытку.';
  } finally { busy.value = false; }
}
</script>

<template>
  <div class="api-settings">
    <div class="admin-page-heading">
      <h1 class="admin-title">Подключение по API</h1>
    </div>
    <p v-if="error" class="error-text" role="alert">Не удалось загрузить настройки. <button type="button" class="btn-secondary" @click="refresh()">Повторить загрузку</button></p>
    <section class="admin-panel api-connection" aria-label="Данные подключения">
      <label>Адрес API<input :value="baseUrl" readonly /></label>
      <label>Схема OpenAPI<input :value="schemaUrl" readonly /></label>
      <a :href="schemaUrl" target="_blank" rel="noopener noreferrer">Открыть схему OpenAPI</a>
      <p>Авторизация: <code>Authorization: Bearer &lt;ключ&gt;</code></p>
      <template v-if="data?.enabled">
        <label>Ключ API<input :value="key ?? '••••••••••••••••••••••••••••••••'" readonly autocomplete="off" spellcheck="false" /></label>
        <div class="api-actions">
          <button v-if="key" type="button" class="btn-secondary" :disabled="busy" @click="key = null"><EyeOff :size="16" aria-hidden="true" />Скрыть ключ</button>
          <button v-else type="button" class="btn-secondary" :disabled="busy" @click="accessKey()"><Eye :size="16" aria-hidden="true" />Показать ключ</button>
          <button type="button" class="btn-secondary" :disabled="busy" @click="accessKey(true)"><Copy :size="16" aria-hidden="true" />Скопировать ключ</button>
        </div>
      </template>
      <p v-else-if="data" class="api-hint">API выключен: ключ не задан или имеет неверный формат. Укажите <code>NUXT_AGENT_API_TOKEN</code> в серверном окружении (не менее 32 печатных ASCII-символов без пробелов) и перезапустите приложение.</p>
      <p v-else-if="!error" role="status">Загружаем настройки…</p>
      <p v-if="notice" class="toast" role="status">{{ notice }}</p>
      <p v-if="actionError" class="error-text" role="alert">{{ actionError }}</p>
    </section>
  </div>
</template>

<style scoped>
.api-settings { display: grid; gap: 24px; max-width: 900px; }
.api-connection { display: grid; gap: 16px; padding: 24px; min-width: 0; }
.api-connection label { display: grid; gap: 8px; font-weight: 600; }
.api-connection input { width: 100%; min-width: 0; font-family: monospace; font-weight: 400; }
.api-connection a { color: #245fbd; text-decoration: underline; overflow-wrap: anywhere; }
.api-connection code { overflow-wrap: anywhere; }
.api-actions { display: flex; gap: 12px; flex-wrap: wrap; }
.api-hint { color: #63728a; line-height: 1.6; }
@media (max-width: 600px) { .api-connection { padding: 16px; } }
</style>
