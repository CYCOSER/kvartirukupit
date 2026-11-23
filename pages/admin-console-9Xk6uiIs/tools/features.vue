<script setup lang="ts">
import { Plus, Pencil, Trash2 } from 'lucide-vue-next';
import Button from '~/components/ui/button/Button.vue';
import ConfirmDialog from '~/components/ui/alert-dialog/ConfirmDialog.vue';
import { propertyFeatureGroups, propertyFeatureGroupLabels, propertyFeatureSchema, type PropertyFeature, type PropertyFeatureGroup } from '~/shared/property-feature';

definePageMeta({ middleware: 'admin', layout: 'admin' });
const { data, error, refresh } = await useFetch<PropertyFeature[]>('/api/admin/property-features');
const name = ref(''), group = ref<PropertyFeatureGroup>('other');
const editingId = ref<string | null>(null), editedName = ref('');
const deleting = ref<PropertyFeature | null>(null), deleteOpen = ref(false);
const busy = ref(false), notice = ref(''), actionError = ref('');
const groups = computed(() => propertyFeatureGroups.map(value => ({
  value, label: propertyFeatureGroupLabels[value], items: (data.value || []).filter(feature => feature.group === value),
})));

async function save(feature?: PropertyFeature) {
  if (busy.value) return;
  notice.value = '';
  actionError.value = '';
  const parsed = propertyFeatureSchema.safeParse({ name: feature ? editedName.value : name.value, group: feature?.group || group.value });
  if (!parsed.success) { actionError.value = 'Введите название от 1 до 120 символов и выберите группу.'; return; }
  busy.value = true;
  try {
    const saved = await $fetch<PropertyFeature>(`/api/admin/property-features${feature ? '/' + feature.id : ''}`, {
      method: feature ? 'PUT' : 'POST', body: feature ? { name: parsed.data.name } : parsed.data, retry: 0,
    });
    data.value = [...(data.value || []).filter(item => item.id !== saved.id), saved]
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    if (feature) editingId.value = null;
    else name.value = '';
    notice.value = feature ? 'Название обновлено во всех объектах.' : 'Преимущество добавлено. Теперь его можно выбрать в карточке объекта.';
  } catch (cause: any) {
    actionError.value = cause.data?.data?.message || cause.data?.message || 'Не удалось сохранить преимущество. Повторите попытку.';
  } finally { busy.value = false; }
}

async function remove() {
  const feature = deleting.value;
  if (!feature || busy.value) return;
  busy.value = true;
  notice.value = '';
  actionError.value = '';
  try {
    await $fetch(`/api/admin/property-features/${feature.id}`, { method: 'DELETE', retry: 0 });
    data.value = (data.value || []).filter(item => item.id !== feature.id);
    if (editingId.value === feature.id) editingId.value = null;
    notice.value = 'Преимущество удалено из справочника и объектов.';
  } catch (cause: any) {
    actionError.value = cause.data?.data?.message || cause.data?.message || 'Не удалось удалить преимущество. Повторите попытку.';
  } finally { busy.value = false; }
}
</script>

<template>
  <div class="feature-settings">
    <div class="admin-page-heading">
      <div><h1 class="admin-title">Преимущества объектов</h1>
        <p class="admin-subtitle">Общий справочник отопления, территории, локаций и других преимуществ.</p></div>
    </div>
    <p class="feature-hint">Выбирайте преимущества в карточках ЖК и квартир. Квартиры могут наследовать их от своего ЖК. Переименование обновляет название во всех карточках.</p>
    <p v-if="error" class="error-text" role="alert">Не удалось загрузить справочник. <button type="button" class="btn-secondary" @click="refresh()">Повторить загрузку</button></p>
    <form class="admin-panel feature-create" aria-label="Новое преимущество" @submit.prevent="save()">
      <label>Группа<AppSelect v-model="group" aria-label="Группа преимущества" :disabled="busy || !data">
        <AppSelectOption v-for="item in groups" :key="item.value" :value="item.value">{{ item.label }}</AppSelectOption>
      </AppSelect></label>
      <label>Название<input v-model="name" aria-label="Название преимущества" required maxlength="120" :disabled="busy || !data" placeholder="Например: Подземный паркинг" /></label>
      <Button type="submit" :disabled="busy || !data || !name.trim()"><Plus :size="16" aria-hidden="true" />Добавить</Button>
    </form>
    <p v-if="notice" class="toast" role="status">{{ notice }}</p>
    <p v-if="actionError" class="error-text" role="alert">{{ actionError }}</p>
    <template v-if="data">
      <section v-for="item in groups" :key="item.value" class="admin-panel feature-group" :aria-label="item.label">
        <h2>{{ item.label }} <span>{{ item.items.length }}</span></h2>
        <p v-if="!item.items.length" class="feature-hint">Пока нет преимуществ. Добавьте первое через форму выше.</p>
        <ul v-else>
          <li v-for="feature in item.items" :key="feature.id">
            <form v-if="editingId === feature.id" class="feature-edit" :aria-label="'Редактирование: ' + feature.name" @submit.prevent="save(feature)">
              <label class="sr-only" :for="'feature-' + feature.id">Новое название</label>
              <input :id="'feature-' + feature.id" v-model="editedName" required maxlength="120" :disabled="busy" />
              <Button type="submit" :disabled="busy || !editedName.trim()">Сохранить</Button>
              <button type="button" class="btn-secondary" :disabled="busy" @click="editingId = null">Отмена</button>
            </form>
            <template v-else>
              <span class="feature-name">{{ feature.name }}</span>
              <div class="feature-actions">
                <button type="button" class="btn-secondary" :aria-label="'Переименовать: ' + feature.name" :disabled="busy" @click="editingId = feature.id; editedName = feature.name"><Pencil :size="16" aria-hidden="true" />Переименовать</button>
                <button type="button" class="btn-secondary" :aria-label="'Удалить: ' + feature.name" :disabled="busy" @click="deleting = feature; deleteOpen = true"><Trash2 :size="16" aria-hidden="true" />Удалить</button>
              </div>
            </template>
          </li>
        </ul>
      </section>
    </template>
    <ConfirmDialog v-model:open="deleteOpen" title="Удалить преимущество?" :description="`«${deleting?.name || ''}» будет удалено из справочника и всех объектов, в которых оно выбрано или наследуется от ЖК.`" @confirm="remove" />
  </div>
</template>

<style scoped>
.feature-settings { display: grid; gap: 20px; max-width: 1100px; }
.feature-hint { color: #63738d; font-size: 0.875rem; line-height: 1.6; }
.feature-create { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(220px, 2fr) auto; align-items: end; gap: 16px; }
.feature-create label { display: grid; gap: 8px; font-size: 0.875rem; font-weight: 600; min-width: 0; }
.feature-settings input { min-width: 0; width: 100%; padding: 11px 13px; border: 1px solid #dce5f2; border-radius: 8px; background: white; font-size: 0.875rem; }
.feature-settings button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
.feature-group h2 { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; font-size: 1.125rem; font-weight: 700; }
.feature-group h2 span { color: #63738d; font-size: 0.875rem; font-weight: 400; }
.feature-group li { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 0; border-top: 1px solid #edf1f7; }
.feature-name { overflow-wrap: anywhere; font-size: 0.9375rem; }
.feature-actions { display: flex; gap: 8px; flex-shrink: 0; }
.feature-edit { display: flex; width: 100%; gap: 8px; }
@media (max-width: 700px) {
  .feature-create { grid-template-columns: 1fr; }
  .feature-group li { align-items: stretch; flex-direction: column; }
  .feature-actions { flex-wrap: wrap; }
  .feature-edit { flex-wrap: wrap; }
  .feature-edit input { flex-basis: 100%; }
  .feature-settings .admin-panel { padding: 16px; }
}
</style>
