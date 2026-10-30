<script setup lang="ts">
import {
  Building2,
  Search,
  Plus,
  Download,
  CheckCircle2,
  FileText,
  Eye,
  PencilLine,
  ArrowUpRight,
  Trash2,
  SlidersHorizontal,
  X,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-vue-next";
import Button from "~/components/ui/button/Button.vue";
import ConfirmDialog from "~/components/ui/alert-dialog/ConfirmDialog.vue";
import { statuses, housingMarkets, money } from "~/shared/property";
import {
  adminPropertyTypes,
  adminPropertyType,
  type AdminPropertyListItem,
} from "~/shared/admin-property";
import {
  sortAdminProperties,
  type AdminSortField,
  type AdminSortDirection,
} from "~/shared/admin-property-sort";
definePageMeta({ middleware: "admin", layout: "admin" });
const { data, refresh, error } = await useFetch<AdminPropertyListItem[]>(
  "/api/admin/properties",
  { query: { view: "list" } },
);
const filters = reactive({
  query: "",
  status: "",
  catalog: "",
  type: "",
  publication: "",
  featured: "",
  housingMarket: "",
  priceMin: "" as string | number,
  priceMax: "" as string | number,
  areaMin: "" as string | number,
  areaMax: "" as string | number,
});
const deleting = ref<AdminPropertyListItem | null>(null),
  confirm = ref(false),
  notice = ref("");
const totals = computed(() => ({
  all: data.value?.length || 0,
  published: data.value?.filter((p) => p.published).length || 0,
  drafts: data.value?.filter((p) => !p.published).length || 0,
}));
const hasFilters = computed(() =>
  Object.values(filters).some((value) => value !== ""),
);
const sortField = ref<AdminSortField | null>(null);
const sortDirection = ref<AdminSortDirection>("asc");
const columns: { label: string; field: AdminSortField; sortLabel: string }[][] =
  [
    [{ label: "Объект", field: "title", sortLabel: "названию" }],
    [
      { label: "Цена", field: "price", sortLabel: "цене" },
      { label: "площадь", field: "area", sortLabel: "площади" },
    ],
    [{ label: "Статус", field: "status", sortLabel: "статусу" }],
    [{ label: "Публикация", field: "published", sortLabel: "публикации" }],
  ];
function sortBy(field: AdminSortField) {
  sortDirection.value =
    sortField.value === field && sortDirection.value === "asc" ? "desc" : "asc";
  sortField.value = field;
}
function inRange(
  value: number | null,
  min: string | number,
  max: string | number,
) {
  if (min === "" && max === "") return true;
  return (
    value !== null &&
    (min === "" || value >= Number(min)) &&
    (max === "" || value <= Number(max))
  );
}
const filtered = computed(
  () =>
    data.value?.filter(
      (p) =>
        (!filters.status || p.status === filters.status) &&
        (!filters.catalog || p.elite === (filters.catalog === "elite")) &&
        (!filters.type || adminPropertyType(p) === filters.type) &&
        (!filters.publication ||
          p.published === (filters.publication === "published")) &&
        (!filters.featured || p.featured === (filters.featured === "yes")) &&
        (!filters.housingMarket ||
          (p.type === "apartment" &&
            (filters.housingMarket === "unknown"
              ? !p.housingMarket
              : p.housingMarket === filters.housingMarket))) &&
        inRange(p.price, filters.priceMin, filters.priceMax) &&
        inRange(p.area, filters.areaMin, filters.areaMax) &&
        (p.title + " " + p.location + " " + p.address)
          .toLowerCase()
          .includes(filters.query.trim().toLowerCase()),
    ) || [],
);
const sorted = computed(() =>
  sortAdminProperties(filtered.value, sortField.value, sortDirection.value),
);
const page = ref(1);
const pageSize = ref(20);
const pageCount = computed(() =>
  Math.max(1, Math.ceil(filtered.value.length / pageSize.value)),
);
const pageItems = computed(() =>
  sorted.value.slice(
    (page.value - 1) * pageSize.value,
    page.value * pageSize.value,
  ),
);
watch([filters, pageSize, sortField, sortDirection], () => {
  page.value = 1;
});
watch(pageCount, (count) => {
  page.value = Math.min(page.value, count);
});
const selectedIds = ref(new Set<string>());
const bulkBusy = ref(false);
const confirmBulkDelete = ref(false);
watch(filtered, (items) => {
  selectedIds.value = new Set(
    items.filter((p) => selectedIds.value.has(p.id)).map((p) => p.id),
  );
});

async function bulkAction(action: "publish" | "unpublish" | "delete") {
  if (bulkBusy.value || !selectedIds.value.size) return;
  const ids = [...selectedIds.value];
  let completed = 0;
  let failed = 0;
  bulkBusy.value = true;
  notice.value = "";
  try {
    // Keep each request within the API body size limit.
    for (let offset = 0; offset < ids.length; offset += 500) {
      const batch = ids.slice(offset, offset + 500);
      try {
        const result = await $fetch<{ count: number }>(
          "/api/admin/properties/bulk",
          {
            method: "POST",
            body: { action, ids: batch },
          },
        );
        completed += result.count;
        batch.forEach((id) => selectedIds.value.delete(id));
      } catch {
        failed += batch.length;
      }
    }
    const label = {
      publish: "Опубликовано",
      unpublish: "Снято с публикации",
      delete: "Удалено",
    }[action];
    notice.value =
      `${label}: ${completed}.` +
      (action === "delete" && completed ? " Связанные заявки сохранены." : "") +
      (failed
        ? ` Не удалось обработать: ${failed}. Повторите действие для оставшихся выбранных объектов.`
        : "");
    await refresh();
  } finally {
    bulkBusy.value = false;
  }
}
function resetFilters() {
  Object.assign(filters, {
    query: "",
    status: "",
    catalog: "",
    type: "",
    publication: "",
    featured: "",
    housingMarket: "",
    priceMin: "",
    priceMax: "",
    areaMin: "",
    areaMax: "",
  });
}
async function remove() {
  if (!deleting.value) return;
  try {
    await $fetch("/api/admin/properties/" + deleting.value.id, {
      method: "DELETE",
    });
    await refresh();
    notice.value = "Объект удалён. Связанные заявки сохранены.";
  } catch {
    notice.value = "Не удалось удалить объект.";
  }
}
async function publish(p: AdminPropertyListItem) {
  try {
    await $fetch("/api/admin/properties/bulk", {
      method: "POST",
      body: { action: p.published ? "unpublish" : "publish", ids: [p.id] },
    });
    await refresh();
  } catch {
    notice.value = "Не удалось изменить публикацию.";
  }
}
</script>
<template>
  <div>
    <div class="admin-page-heading">
      <div>
        <h1 class="admin-title">ЖК и квартиры</h1>
      </div>
      <div class="admin-heading-actions">
        <NuxtLink
          to="/admin-console-9Xk6uiIs/properties/import"
          class="btn-secondary"
          ><Download :size="17" aria-hidden="true" />Импорт из CRM</NuxtLink
        >
        <NuxtLink
          to="/admin-console-9Xk6uiIs/properties/import?source=nmarket"
          class="btn-secondary"
          ><Download :size="17" aria-hidden="true" />Импорт из
          Нмаркета</NuxtLink
        >
        <Button as-child
          ><NuxtLink to="/admin-console-9Xk6uiIs/properties/new"
            ><Plus :size="18" aria-hidden="true" />Добавить объект</NuxtLink
          ></Button
        >
      </div>
    </div>
    <div class="admin-stats" aria-label="Состояние каталога">
      <div class="admin-stat">
        <span class="admin-stat-icon"
          ><Building2 :size="21" aria-hidden="true"
        /></span>
        <div>
          <span>Всего объектов</span
          ><strong>{{
            error ? "—" : totals.all.toLocaleString("ru-RU")
          }}</strong>
        </div>
      </div>
      <div class="admin-stat">
        <span class="admin-stat-icon is-green"
          ><CheckCircle2 :size="21" aria-hidden="true"
        /></span>
        <div>
          <span>Опубликовано</span
          ><strong>{{
            error ? "—" : totals.published.toLocaleString("ru-RU")
          }}</strong>
        </div>
      </div>
      <div class="admin-stat">
        <span class="admin-stat-icon is-amber"
          ><FileText :size="21" aria-hidden="true"
        /></span>
        <div>
          <span>Черновики</span
          ><strong>{{
            error ? "—" : totals.drafts.toLocaleString("ru-RU")
          }}</strong>
        </div>
      </div>
    </div>
    <section class="admin-panel admin-filters" aria-label="Фильтры объектов">
      <div class="admin-filter-heading">
        <span
          ><SlidersHorizontal :size="17" aria-hidden="true" />Поиск и
          фильтры</span
        ><button v-if="hasFilters" class="admin-reset" @click="resetFilters">
          <X :size="15" aria-hidden="true" />Сбросить фильтры
        </button>
      </div>
      <div class="admin-search">
        <Search :size="19" aria-hidden="true" /><input
          v-model="filters.query"
          aria-label="Поиск объектов"
          placeholder="Название, локация или адрес"
        />
      </div>
      <div class="admin-filter-grid">
        <label
          >Тип объекта<AppSelect v-model="filters.type" aria-label="Тип объекта"
            ><AppSelectOption value="">Все типы</AppSelectOption
            ><AppSelectOption
              v-for="(label, value) in adminPropertyTypes"
              :key="value"
              :value="value"
              >{{ label }}</AppSelectOption
            ></AppSelect
          ></label
        >
        <label
          >Статус<AppSelect v-model="filters.status" aria-label="Статус объекта"
            ><AppSelectOption value="">Все статусы</AppSelectOption
            ><AppSelectOption
              v-for="(label, value) in statuses"
              :key="value"
              :value="value"
              >{{ label }}</AppSelectOption
            ></AppSelect
          ></label
        >
        <label
          >Каталог<AppSelect
            v-model="filters.catalog"
            aria-label="Каталог объектов"
            ><AppSelectOption value="">Все каталоги</AppSelectOption
            ><AppSelectOption value="newbuilds">Новостройки</AppSelectOption
            ><AppSelectOption value="elite"
              >Элитные квартиры</AppSelectOption
            ></AppSelect
          ></label
        >
        <label
          >Публикация<AppSelect
            v-model="filters.publication"
            aria-label="Публикация объекта"
            ><AppSelectOption value="">Все объекты</AppSelectOption
            ><AppSelectOption value="published">Опубликованные</AppSelectOption
            ><AppSelectOption value="draft"
              >Черновики</AppSelectOption
            ></AppSelect
          ></label
        >
        <label class="admin-filter-wide"
          >На главной<AppSelect
            v-model="filters.featured"
            aria-label="На главной"
          >
            <AppSelectOption value="">Все объекты</AppSelectOption>
            <AppSelectOption value="yes">Да</AppSelectOption>
            <AppSelectOption value="no">Нет</AppSelectOption>
          </AppSelect></label
        >
        <label class="admin-filter-wide"
          >Рынок квартиры<AppSelect
            v-model="filters.housingMarket"
            aria-label="Рынок квартиры"
          >
            <AppSelectOption value="">Любой</AppSelectOption>
            <AppSelectOption
              v-for="(label, value) in housingMarkets"
              :key="value"
              :value="value"
              >{{ label }}</AppSelectOption
            >
            <AppSelectOption value="unknown">Не указан</AppSelectOption>
          </AppSelect></label
        >
        <fieldset class="admin-range">
          <legend>Цена, ₽</legend>
          <div>
            <input
              v-model.number="filters.priceMin"
              type="number"
              min="0"
              step="100000"
              aria-label="Цена от"
              placeholder="От"
            /><span aria-hidden="true">—</span
            ><input
              v-model.number="filters.priceMax"
              type="number"
              min="0"
              step="100000"
              aria-label="Цена до"
              placeholder="До"
            />
          </div>
        </fieldset>
        <fieldset class="admin-range">
          <legend>Площадь, м²</legend>
          <div>
            <input
              v-model.number="filters.areaMin"
              type="number"
              min="0"
              step="0.1"
              aria-label="Площадь от"
              placeholder="От"
            /><span aria-hidden="true">—</span
            ><input
              v-model.number="filters.areaMax"
              type="number"
              min="0"
              step="0.1"
              aria-label="Площадь до"
              placeholder="До"
            />
          </div>
        </fieldset>
      </div>
    </section>
    <p v-if="notice" class="toast" role="status">{{ notice }}</p>
    <p v-if="error" class="error-text" role="alert">
      Не удалось загрузить объекты.
    </p>
    <template v-else>
      <div class="admin-results-heading">
        <h2>Объекты каталога</h2>
        <span role="status"
          >Найдено {{ filtered.length.toLocaleString("ru-RU") }} из
          {{ totals.all.toLocaleString("ru-RU") }}</span
        >
      </div>
      <div
        class="admin-bulk-actions"
        role="group"
        aria-label="Массовые действия"
      >
        <Button
          type="button"
          :disabled="bulkBusy || !filtered.length"
          @click="selectedIds = new Set(filtered.map((p) => p.id))"
          >Выбрать все</Button
        >
        <button
          type="button"
          class="btn-secondary"
          :disabled="bulkBusy || !selectedIds.size"
          @click="selectedIds.clear()"
        >
          Снять выбор
        </button>
        <span role="status"
          >Выбрано: {{ selectedIds.size.toLocaleString("ru-RU") }}</span
        >
        <button
          type="button"
          class="btn-secondary"
          :disabled="bulkBusy || !selectedIds.size"
          @click="bulkAction('publish')"
        >
          Опубликовать
        </button>
        <button
          type="button"
          class="btn-secondary"
          :disabled="bulkBusy || !selectedIds.size"
          @click="bulkAction('unpublish')"
        >
          Снять с публикации
        </button>
        <button
          type="button"
          class="btn-danger"
          :disabled="bulkBusy || !selectedIds.size"
          @click="confirmBulkDelete = true"
        >
          Удалить выбранные
        </button>
        <span v-if="bulkBusy" role="status">Обработка объектов…</span>
      </div>
      <nav class="admin-pagination" aria-label="Страницы объектов">
        <label
          >Объектов на странице<AppSelect
            :model-value="String(pageSize)"
            aria-label="Объектов на странице"
            @update:model-value="pageSize = Number($event)"
          >
            <AppSelectOption
              v-for="size in [10, 20, 50]"
              :key="size"
              :value="String(size)"
              >{{ size }}</AppSelectOption
            >
          </AppSelect></label
        >
        <div>
          <button
            type="button"
            class="btn-secondary"
            :disabled="page === 1"
            @click="page--"
          >
            Назад
          </button>
          <span role="status">Страница {{ page }} из {{ pageCount }}</span>
          <button
            type="button"
            class="btn-secondary"
            :disabled="page === pageCount"
            @click="page++"
          >
            Далее
          </button>
        </div>
      </nav>
      <div
        class="admin-table-wrap"
        tabindex="0"
        role="region"
        aria-label="Таблица объектов"
      >
        <table class="admin-table admin-properties-table">
          <thead>
            <tr>
              <th scope="col"><span class="sr-only">Выбор объектов</span></th>
              <th
                v-for="column in columns"
                :key="column[0]!.field"
                scope="col"
                :aria-sort="
                  column.some((item) => item.field === sortField)
                    ? sortDirection === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                "
              >
                <div class="admin-column-sorts">
                  <template v-for="(item, index) in column" :key="item.field">
                    <span v-if="index" aria-hidden="true">/</span>
                    <button
                      type="button"
                      class="admin-column-sort"
                      :class="{ 'is-active': sortField === item.field }"
                      :aria-label="`Сортировать по ${item.sortLabel} ${sortField === item.field && sortDirection === 'asc' ? 'по убыванию' : 'по возрастанию'}`"
                      @click="sortBy(item.field)"
                    >
                      {{ item.label }}
                      <ArrowUp
                        v-if="
                          sortField === item.field && sortDirection === 'asc'
                        "
                        :size="13"
                        aria-hidden="true"
                      />
                      <ArrowDown
                        v-else-if="sortField === item.field"
                        :size="13"
                        aria-hidden="true"
                      />
                      <ArrowUpDown v-else :size="13" aria-hidden="true" />
                    </button>
                  </template>
                </div>
              </th>
              <th scope="col">Действия</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in pageItems" :key="p.id">
              <td>
                <input
                  v-model="selectedIds"
                  type="checkbox"
                  :value="p.id"
                  :aria-label="`Выбрать объект «${p.title}»`"
                  :disabled="bulkBusy"
                />
              </td>
              <td>
                <div class="admin-property-cell">
                  <div class="admin-property-thumb">
                    <img
                      v-if="p.images?.[0]"
                      :src="p.images[0].file"
                      alt=""
                      loading="lazy"
                    /><Building2 v-else :size="23" aria-hidden="true" />
                  </div>
                  <div class="admin-property-info">
                    <NuxtLink
                      :to="'/admin-console-9Xk6uiIs/properties/' + p.id"
                      class="admin-property-name"
                      >{{ p.title }}</NuxtLink
                    ><small
                      >{{ adminPropertyTypes[adminPropertyType(p)] }} ·
                      {{ p.location }}{{ p.demo ? " · ДЕМО" : "" }}</small
                    ><small v-if="p.sourceUrl"
                      ><a
                        :href="p.sourceUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="admin-source-link"
                        >{{ p.sourceName || "Источник"
                        }}<ArrowUpRight :size="12" aria-hidden="true" /></a
                    ></small>
                  </div>
                </div>
              </td>
              <td class="whitespace-nowrap">
                <strong class="admin-price">{{ money(p.price) }}</strong
                ><small>{{
                  p.area === null
                    ? "Площадь не указана"
                    : p.area.toLocaleString("ru-RU") + " м²"
                }}</small>
              </td>
              <td>
                <span class="admin-status" :class="'is-' + p.status">{{
                  statuses[p.status]
                }}</span>
              </td>
              <td>
                <button
                  class="admin-publication"
                  :disabled="bulkBusy"
                  :class="{ 'is-published': p.published }"
                  :title="
                    p.published ? 'Снять с публикации' : 'Опубликовать объект'
                  "
                  @click="publish(p)"
                >
                  <Eye v-if="p.published" :size="18" aria-hidden="true" />
                  <PencilLine v-else :size="18" aria-hidden="true" />
                  {{ p.published ? "Опубликован" : "Черновик" }}
                </button>
              </td>
              <td>
                <button
                  class="admin-delete"
                  :disabled="bulkBusy"
                  @click="
                    deleting = p;
                    confirm = true;
                  "
                >
                  <Trash2 :size="15" aria-hidden="true" />Удалить
                </button>
              </td>
            </tr>
            <tr v-if="!filtered.length">
              <td colspan="6" class="admin-empty">
                <Search :size="28" aria-hidden="true" /><strong
                  >Объекты не найдены.</strong
                ><span>{{
                  hasFilters
                    ? "Попробуйте изменить условия поиска."
                    : "Добавьте первый объект вручную или импортируйте из CRM."
                }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    <ConfirmDialog
      v-model:open="confirmBulkDelete"
      title="Удалить выбранные объекты?"
      :description="`Объектов к удалению: ${selectedIds.size.toLocaleString('ru-RU')}. Они исчезнут из каталога. Связанные заявки сохранятся. Восстановление возможно из резервной копии.`"
      @confirm="bulkAction('delete')"
    />
    <ConfirmDialog
      v-model:open="confirm"
      title="Удалить объект?"
      :description="
        'Объект «' +
        (deleting?.title || '') +
        '» исчезнет из каталога. Восстановление возможно из резервной копии.'
      "
      @confirm="remove"
    />
  </div>
</template>
