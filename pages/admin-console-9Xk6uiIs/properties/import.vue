<script setup lang="ts">
import {
  ArrowLeft,
  ArrowDownToLine,
  CheckCircle2,
  Database,
  Search,
  SlidersHorizontal,
  RefreshCw,
} from "lucide-vue-next";
import Button from "~/components/ui/button/Button.vue";
import { money } from "~/shared/property";
import {
  emptyImportFilters,
  filterImportObjects,
  importFilterError,
  type ImportObject,
} from "~/shared/import-catalog";

definePageMeta({
  middleware: "admin",
  layout: "admin",
  key: "property-import",
});
const route = useRoute();
const source = computed(() => route.query.source === "nmarket" ? "nmarket" : "rf39");
const isNmarket = computed(() => source.value === "nmarket");
const sourceName = computed(() => isNmarket.value ? "Нмаркет" : "CRM RF39");
const endpoint = computed(() => "/api/admin/" + source.value);
const ready = ref(false);
onMounted(() => {
  ready.value = true;
  void loadObjects(isNmarket.value ? "saved" : null);
});
type ImportResult = { id: string; created: boolean; warnings: string[] };
type ImportPage = {
  items: ImportObject[];
  nextOffset: number | null;
  snapshotDate?: string;
};

const items = ref<ImportObject[]>([]);
const selected = ref<(string | number)[]>([]);
const snapshot = ref<"saved" | null>(null);
const snapshotDate = ref("");
const snapshotLabel = computed(() =>
  snapshotDate.value
    ? new Date(snapshotDate.value).toLocaleString("ru-RU", {
        timeZone: "Europe/Moscow",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "",
);
const filters = reactive(emptyImportFilters());
const nextOffset = ref<number | null>(0);
const loading = ref(false),
  importing = ref(false);
const listError = ref("");
const importErrors = ref<string[]>([]);
const completed = ref(0),
  importTotal = ref(0),
  createdCount = ref(0),
  existingCount = ref(0),
  activeTitle = ref("");
const results = ref<
  (ImportResult & { sourceId: string | number; title: string })[]
>([]);
const page = ref(1),
  pageSize = 50;
let disposed = false;
let requestVersion = 0;
onBeforeUnmount(() => {
  disposed = true;
  requestVersion++;
});
watch(source, () => {
  requestVersion++;
  items.value = [];
  selected.value = [];
  results.value = [];
  snapshot.value = null;
  snapshotDate.value = "";
  nextOffset.value = 0;
  page.value = 1;
  loading.value = importing.value = false;
  listError.value = activeTitle.value = "";
  importErrors.value = [];
  completed.value = importTotal.value = 0;
  createdCount.value = existingCount.value = 0;
  Object.assign(filters, emptyImportFilters());
  if (ready.value) void loadObjects(isNmarket.value ? "saved" : null);
});
const options = (field: "category" | "location" | "developer") =>
  [
    ...new Set(
      items.value
        .map((item) => item[field])
        .filter((value): value is string => !!value),
    ),
  ].sort((a, b) => a.localeCompare(b, "ru"));
const categories = computed(() => options("category"));
const cities = computed(() => options("location"));
const developers = computed(() => options("developer"));
const filterError = computed(() => importFilterError(filters));
const filtered = computed(() => filterImportObjects(items.value, filters));
const eligible = computed(() =>
  filtered.value.filter((item) => item.supported && !item.existingId),
);
const totalPages = computed(() =>
  Math.max(1, Math.ceil(filtered.value.length / pageSize)),
);
const pageItems = computed(() =>
  filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize),
);
const hiddenSelected = computed(
  () =>
    selected.value.filter(
      (id) => !filtered.value.some((item) => item.id === id),
    ).length,
);
watch(filters, () => {
  page.value = 1;
});
watch(totalPages, (value) => {
  page.value = Math.min(page.value, value);
});

async function loadObjects(requestedSnapshot: "saved" | null = null, refresh = false) {
  if (loading.value || importing.value) return;
  const version = requestVersion;
  const requestEndpoint = endpoint.value;
  let snapshotRestarts = 0;
  const previousList = refresh && nextOffset.value === null
    ? { items: items.value, selected: selected.value, date: snapshotDate.value }
    : null;
  if (snapshot.value !== requestedSnapshot) {
    results.value = [];
    importTotal.value = 0;
    importErrors.value = [];
    Object.assign(filters, emptyImportFilters());
  }
  if (refresh || nextOffset.value === null || snapshot.value !== requestedSnapshot) {
    nextOffset.value = 0;
    items.value = [];
    selected.value = [];
    page.value = 1;
    snapshotDate.value = "";
  }
  snapshot.value = requestedSnapshot;
  loading.value = true;
  listError.value = "";
  const paginationError = new Error(
    (isNmarket.value ? "Нмаркет повторил" : "CRM повторила") +
      " страницу списка. Загрузка остановлена; уже полученные объекты сохранены.",
  );
  const snapshotChangedError = new Error("Выгрузка CRM обновляется другим администратором. Откройте список повторно.");
  try {
    while (nextOffset.value !== null && !disposed && version === requestVersion) {
      const result: ImportPage = await $fetch<ImportPage>(
        requestEndpoint + "/objects",
        {
          query: {
            offset: nextOffset.value,
            ...(snapshot.value ? { snapshot: snapshot.value } : {}),
            ...(nextOffset.value === 0 && (refresh || (isNmarket.value && !snapshot.value)) ? { refresh: 1 } : {}),
          },
          retry: 0,
        },
      );
      if (disposed || version !== requestVersion) break;
      if (requestEndpoint === '/api/admin/rf39' && snapshotDate.value &&
          result.snapshotDate && result.snapshotDate !== snapshotDate.value) {
        items.value = [];
        selected.value = [];
        snapshotDate.value = "";
        nextOffset.value = 0;
        refresh = false;
        if (snapshotRestarts++) throw snapshotChangedError;
        continue;
      }
      const knownIds = new Set(items.value.map((item) => item.id));
      if (
        (result.nextOffset !== null && result.nextOffset <= nextOffset.value) ||
        (result.items.length > 0 &&
          result.items.every((item) => knownIds.has(item.id)))
      )
        throw paginationError;
      items.value = [
        ...new Map(
          [...items.value, ...result.items].map((item) => [item.id, item]),
        ).values(),
      ];
      nextOffset.value = result.nextOffset;
      snapshotDate.value = result.snapshotDate || "";
    }
  } catch (error: any) {
    if (disposed || version !== requestVersion) return;
    if (previousList && nextOffset.value === 0) {
      items.value = previousList.items;
      selected.value = previousList.selected;
      snapshotDate.value = previousList.date;
      nextOffset.value = null;
    }
    listError.value =
      error === paginationError || error === snapshotChangedError
        ? error.message
        : error.data?.data?.message ||
          error.data?.message ||
          "Не удалось получить список: " + sourceName.value + ".";
  } finally {
    if (version === requestVersion) loading.value = false;
  }
}

function selectCategory() {
  selected.value = [
    ...new Set([...selected.value, ...eligible.value.map((item) => item.id)]),
  ];
}

async function importSelected() {
  if (loading.value || importing.value) return;
  const version = requestVersion;
  const requestEndpoint = endpoint.value;
  const pending = items.value.filter(
    (item) =>
      selected.value.includes(item.id) && item.supported && !item.existingId,
  );
  importing.value = true;
  importErrors.value = [];
  completed.value = createdCount.value = existingCount.value = 0;
  importTotal.value = pending.length;
  try {
    for (const item of pending) {
      if (disposed || version !== requestVersion) break;
      activeTitle.value = item.title;
      try {
        const result = await $fetch<ImportResult>(requestEndpoint + "/import", {
          method: "POST",
          body: {
            id: item.id,
            ...(snapshot.value ? { snapshot: snapshot.value } : {}),
          },
          retry: 0,
        });
        if (disposed || version !== requestVersion) break;
        results.value.push({ ...result, sourceId: item.id, title: item.title });
        item.existingId = result.id;
        selected.value = selected.value.filter((id) => id !== item.id);
        if (result.created) createdCount.value++;
        else existingCount.value++;
      } catch (error: any) {
        if (disposed || version !== requestVersion) break;
        importErrors.value.push(
          `Не удалось импортировать «${item.title}» (ID ${item.id}). ` +
          (error.data?.data?.message || error.data?.message || "Попробуйте ещё раз."),
        );
      }
      completed.value++;
    }
  } finally {
    if (version === requestVersion) {
      importing.value = false;
      activeTitle.value = "";
    }
  }
}
</script>

<template>
  <div class="import-page">
    <NuxtLink to="/admin-console-9Xk6uiIs/properties" class="import-back"
      ><ArrowLeft :size="16" /> Все объекты</NuxtLink
    >
    <header class="import-heading">
      <div>
        <h1 class="admin-title">
          Импорт из {{ isNmarket ? "Нмаркета" : sourceName }}
        </h1>
      </div>
      <span class="import-draft-badge"
        ><CheckCircle2 :size="16" /> Сохраняем черновиками</span
      >
    </header>
    <ImportSourceToggle
      :model-value="isNmarket ? 'nmarket' : 'rf39'"
      :disabled="!ready || loading || importing"
      @update:model-value="navigateTo('/admin-console-9Xk6uiIs/properties/import' + ($event === 'nmarket' ? '?source=nmarket' : ''))"
    />
    <section class="import-source-card">
      <div class="import-source-icon"><ArrowDownToLine :size="24" /></div>
      <div class="import-source-copy">
        <h2>
          {{ isNmarket ? "Квартиры и жилые комплексы" : "Объекты агентства" }}
        </h2>
        <p v-if="!items.length && !loading">Список предложений пока не загружен.</p>
        <p
          v-else-if="loading && !items.length"
          role="status"
          aria-live="polite"
        >
          {{ snapshot ? 'Открываем сохранённую выгрузку Нмаркета.' : isNmarket ? 'Получаем выгрузку Нмаркета. Первая загрузка может занять несколько минут.' : 'Открываем выгрузку CRM. Первая загрузка может занять несколько минут.' }}
        </p>
        <p v-else role="status" aria-live="polite">
          Загружено: {{ items.length.toLocaleString("ru")
          }}{{
            nextOffset === null
              ? " · список получен полностью"
              : " · получаем предложения"
          }}
        </p>
      </div>
      <div class="import-load-actions">
        <Button
          :disabled="!ready || loading || importing"
          @click="loadObjects(nextOffset !== null && items.length ? snapshot : null, !isNmarket && (nextOffset === null || nextOffset === 0))"
          ><RefreshCw :size="16" :class="{ 'animate-spin': loading }" />{{
            loading
              ? "Получаем список…"
              : nextOffset !== null && items.length
                ? "Продолжить загрузку"
                : isNmarket ? "Обновить из Нмаркета" : "Обновить из CRM"
          }}</Button
        >
      </div>
    </section>
    <p
      v-if="snapshotLabel && (snapshot || !isNmarket)"
      class="import-snapshot-note"
      role="status"
    >
      Сохранённая выгрузка от {{ snapshotLabel }}. Цены и наличие могли
      измениться: проверьте их перед публикацией.
    </p>
    <p v-if="listError" class="import-error" role="alert">
      {{ listError }} {{ nextOffset === null ? 'Продолжаем показывать сохранённую выгрузку.' : 'Повторная загрузка продолжится с места остановки.' }}
    </p>

    <template v-if="items.length">
      <section class="import-filters" aria-label="Фильтры объектов">
        <div class="import-filter-heading">
          <h2><SlidersHorizontal :size="18" /> Поиск и фильтры</h2>
          <button
            class="import-reset"
            @click="Object.assign(filters, emptyImportFilters())"
          >
            Сбросить фильтры
          </button>
        </div>
        <div class="import-filter-grid">
          <label class="import-search"
            ><span>Поиск</span>
            <div>
              <Search :size="18" /><input
                v-model="filters.query"
                :aria-label="
                  isNmarket ? 'Поиск объектов Нмаркета' : 'Поиск объектов CRM'
                "
                placeholder="ЖК, адрес, ID или застройщик"
              /></div
          ></label>
          <label
            ><span>Категория</span
            ><AppSelect
              v-model="filters.category"
              :aria-label="isNmarket ? 'Категория Нмаркета' : 'Категория CRM'"
              ><AppSelectOption value="">Все категории</AppSelectOption
              ><AppSelectOption
                v-for="name in categories"
                :key="name"
                :value="name"
                >{{ name }}</AppSelectOption
              ></AppSelect
            ></label
          >
          <label
            ><span>Город</span
            ><AppSelect v-model="filters.city" aria-label="Город"
              ><AppSelectOption value="">Все города</AppSelectOption
              ><AppSelectOption
                v-for="city in cities"
                :key="city"
                :value="city"
                >{{ city }}</AppSelectOption
              ></AppSelect
            ></label
          >
          <fieldset>
            <legend>Цена, ₽</legend>
            <div class="import-range">
              <input
                v-model="filters.minPrice"
                type="number"
                min="0"
                step="1"
                aria-label="Цена от"
                placeholder="От"
              /><span>—</span
              ><input
                v-model="filters.maxPrice"
                type="number"
                min="0"
                step="1"
                aria-label="Цена до"
                placeholder="До"
              />
            </div>
          </fieldset>
          <fieldset>
            <legend>Площадь, м²</legend>
            <div class="import-range">
              <input
                v-model="filters.minArea"
                type="number"
                min="0"
                step="0.1"
                aria-label="Площадь от"
                placeholder="От"
              /><span>—</span
              ><input
                v-model="filters.maxArea"
                type="number"
                min="0"
                step="0.1"
                aria-label="Площадь до"
                placeholder="До"
              />
            </div>
          </fieldset>
          <label
            ><span>Комнат</span
            ><AppSelect v-model="filters.rooms" aria-label="Комнат"
              ><AppSelectOption value="">Любое количество</AppSelectOption
              ><AppSelectOption value="0">Студия</AppSelectOption
              ><AppSelectOption
                v-for="count in ['1', '2', '3', '4+']"
                :key="count"
                :value="count"
                >{{ count }}</AppSelectOption
              ></AppSelect
            ></label
          >
          <label
            ><span>Застройщик</span
            ><AppSelect v-model="filters.developer" aria-label="Застройщик"
              ><AppSelectOption value="">Все застройщики</AppSelectOption
              ><AppSelectOption
                v-for="name in developers"
                :key="name"
                :value="name"
                >{{ name }}</AppSelectOption
              ></AppSelect
            ></label
          >
          <label
            ><span>Статус импорта</span
            ><AppSelect v-model="filters.status" aria-label="Статус импорта"
              ><AppSelectOption value="">Все объекты</AppSelectOption
              ><AppSelectOption value="ready">Готовы к импорту</AppSelectOption
              ><AppSelectOption value="imported">Уже добавлены</AppSelectOption
              ><AppSelectOption value="unsupported"
                >Недоступны для импорта</AppSelectOption
              ></AppSelect
            ></label
          >
          <label
            ><span>Сортировка</span
            ><AppSelect v-model="filters.sort" aria-label="Сортировка"
              ><AppSelectOption value="title">По названию</AppSelectOption
              ><AppSelectOption value="price-asc"
                >Сначала дешевле</AppSelectOption
              ><AppSelectOption value="price-desc"
                >Сначала дороже</AppSelectOption
              ><AppSelectOption value="area-asc"
                >Площадь по возрастанию</AppSelectOption
              ><AppSelectOption value="area-desc"
                >Площадь по убыванию</AppSelectOption
              ></AppSelect
            ></label
          >
        </div>
        <p v-if="filterError" class="import-error" role="alert">
          {{ filterError }}
        </p>
        <p class="import-filter-hint">
          Диапазоны применяются к объектам с указанной ценой и площадью. Для ЖК
          эти данные могут отсутствовать.
        </p>
      </section>
      <div class="import-selection">
        <div>
          <strong>Найдено: {{ filtered.length.toLocaleString("ru") }}</strong
          ><span> · Выбрано: {{ selected.length }}</span
          ><small v-if="hiddenSelected"
            >Из них скрыто фильтрами: {{ hiddenSelected }}</small
          >
        </div>
        <div class="import-selection-actions">
          <button
            class="btn-secondary"
            :disabled="nextOffset !== null || importing || !eligible.length"
            @click="selectCategory"
          >
            {{
              filters.category ? "Выбрать категорию" : "Выбрать все найденные"
            }}</button
          ><button
            class="btn-secondary"
            :disabled="importing || !selected.length"
            @click="selected = []"
          >
            Снять выбор</button
          ><Button
            :disabled="loading || importing || !selected.length"
            @click="importSelected"
            ><ArrowDownToLine :size="16" />{{
              importing
                ? "Создаём карточки…"
                : "Создать черновики (" + selected.length + ")"
            }}</Button
          >
        </div>
      </div>
      <p v-if="nextOffset !== null" class="import-filter-hint">
        Выбор всех найденных доступен после полной загрузки списка.
      </p>
    </template>

    <div
      v-if="importTotal"
      class="import-progress"
      role="status"
      aria-live="polite"
    >
      <span
        >Обработано: {{ completed }} из {{ importTotal
        }}{{ activeTitle ? " · " + activeTitle : "" }}</span
      >
      <p>
        Создано: {{ createdCount }} · Уже добавлены: {{ existingCount }} ·
        Пропущено: {{ importErrors.length }}
      </p>
      <progress
        :value="completed"
        :max="importTotal"
        aria-label="Ход импорта"
      />
    </div>
    <div v-if="importErrors.length" class="import-error" role="alert">
      <p>
        Пропущено: {{ importErrors.length }}. Объекты с ошибками остаются
        выбранными для повторного импорта.
      </p>
      <ul>
        <li v-for="message in importErrors" :key="message">{{ message }}</li>
      </ul>
    </div>
    <section
      v-if="results.length"
      class="import-results"
      aria-labelledby="import-results"
    >
      <h2 id="import-results">
        <CheckCircle2 :size="19" /> Результаты импорта
      </h2>
      <ul>
        <li v-for="result in results" :key="result.sourceId">
          <NuxtLink :to="'/admin-console-9Xk6uiIs/properties/' + result.id"
            >{{ result.title }} —
            {{
              result.created ? "открыть черновик" : "уже добавлен, открыть"
            }}</NuxtLink
          >
          <p v-for="warning in result.warnings" :key="warning">{{ warning }}</p>
        </li>
      </ul>
    </section>

    <div v-if="items.length" class="admin-table-wrap import-table-wrap">
      <table class="admin-table import-table">
        <thead>
          <tr>
            <th class="import-check-col">Выбор</th>
            <th>Объект</th>
            <th>Параметры</th>
            <th>Цена</th>
            <th>Импорт</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in pageItems"
            :key="item.id"
            :class="{ 'is-selected': selected.includes(item.id) }"
          >
            <td>
              <input
                v-if="item.supported && !item.existingId"
                v-model="selected"
                type="checkbox"
                :value="item.id"
                :aria-label="'Выбрать ' + item.title + ' (ID ' + item.id + ')'"
                :disabled="importing"
              />
            </td>
            <td class="import-object">
              <span class="import-category">{{ item.category }}</span
              ><strong>{{ item.title }}</strong
              ><small>{{ item.location }} {{ item.address }}</small
              ><small
                >ID {{ item.id
                }}<template v-if="item.developer">
                  · {{ item.developer }}</template
                ></small
              ><small v-if="item.layoutCount"
                >Корпус / ЖК · Планировок в CRM: {{ item.layoutCount }}</small
              >
            </td>
            <td class="import-params">
              <strong>{{
                item.area != null
                  ? item.area.toLocaleString("ru") + " м²"
                  : "Площадь не указана"
              }}</strong
              ><small
                >{{
                  item.bedrooms != null
                    ? item.bedrooms === 0
                      ? "Студия"
                      : item.bedrooms + " комн."
                    : "Комнаты не указаны"
                }}<template v-if="item.floors">
                  · {{ item.floors }} эт. в доме</template
                ></small
              >
            </td>
            <td class="import-price">{{ money(item.price) }}</td>
            <td>
              <NuxtLink
                v-if="item.existingId"
                :to="'/admin-console-9Xk6uiIs/properties/' + item.existingId"
                class="import-existing"
                >Уже добавлен — открыть</NuxtLink
              ><span v-else-if="!item.supported" class="import-unavailable"
                >Недоступен: импортируются только ЖК и квартиры на
                продажу.</span
              ><span v-else class="import-ready">Готов к импорту</span>
            </td>
          </tr>
          <tr v-if="!filtered.length">
            <td colspan="5" class="import-no-results">
              Объекты не найдены. Попробуйте изменить фильтры.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <nav
      v-if="filtered.length > pageSize"
      class="import-pagination"
      aria-label="Страницы списка"
    >
      <span
        >{{ (page - 1) * pageSize + 1 }}–{{
          Math.min(page * pageSize, filtered.length)
        }}
        из {{ filtered.length.toLocaleString("ru") }}</span
      >
      <div>
        <button class="btn-secondary" :disabled="page === 1" @click="page--">
          Назад</button
        ><span>Страница {{ page }} из {{ totalPages }}</span
        ><button
          class="btn-secondary"
          :disabled="page === totalPages"
          @click="page++"
        >
          Далее
        </button>
      </div>
    </nav>
    <div v-if="nextOffset === null && !items.length && !loading && !listError" class="import-empty">
      <Database :size="38" />
      <h2>В источнике нет объектов</h2>
    </div>
    <p class="import-footnote">
      Повторный импорт сохраняет ручные правки.<template v-if="!isNmarket">
        Квартиры внутри корпуса импортируются отдельно из карточки ЖК.</template
      >
    </p>
  </div>
</template>

<style scoped>
.import-page {
  color: #20344b;
}
.import-back {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  color: #63768c;
  margin-bottom: 24px;
}
.import-back:hover {
  color: #245bc1;
}
.import-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 26px;
}
.import-heading .admin-title {
  margin: 7px 0 8px;
  font-size: 30px;
  line-height: 1.2;
}
.import-draft-badge {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: #357265;
  background: #e8f5ef;
  border: 1px solid #d4e9de;
  padding: 9px 12px;
  border-radius: 999px;
  white-space: nowrap;
}
.import-source-card {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 22px 24px;
  background: white;
  border: 1px solid #e1e8f0;
  border-radius: 14px;
  margin-bottom: 20px;
}
.import-source-icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 13px;
  background: #edf3ff;
  color: #2a60bd;
  flex-shrink: 0;
}
.import-source-copy {
  flex: 1;
}
.import-load-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.import-load-actions .btn-secondary {
  font-size: 11px;
  padding: 9px 12px;
}
.import-snapshot-note {
  margin: 0 0 20px;
  padding: 14px 18px;
  border: 1px solid #eeddba;
  border-radius: 10px;
  background: #fff9ec;
  color: #8d6427;
  font-size: 13px;
}
.import-source-copy h2 {
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 5px;
}
.import-source-copy p {
  font-size: 13px;
  color: #718198;
}
.import-filters {
  background: white;
  border: 1px solid #e1e8f0;
  border-radius: 14px;
  padding: 22px 24px;
  margin-bottom: 22px;
}
.import-filter-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
}
.import-filter-heading h2,
.import-results h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
}
.import-reset {
  color: #3768b7;
  font-size: 12px;
}
.import-filter-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.import-filter-grid label,
.import-filter-grid fieldset {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.import-filter-grid label > span,
.import-filter-grid legend {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: #677b91;
  margin-bottom: 7px;
}
.import-filter-grid input {
  width: 100%;
  max-width: none;
  background: #fafbfd;
  font-size: 13px;
  border: 1px solid #dbe3ec;
  border-radius: 8px;
  padding: 11px 12px;
  height: 44px;
  min-width: 0;
}
.import-filter-grid :deep(.select-field) {
  min-width: 0;
  width: 100%;
  font-size: 13px;
}
.import-search > div {
  position: relative;
}
.import-search svg {
  position: absolute;
  left: 12px;
  top: 13px;
  color: #8091a4;
}
.import-search input {
  padding-left: 38px;
}
.import-range {
  display: flex;
  gap: 8px;
  align-items: center;
}
.import-range span {
  color: #a4b0be;
}
.import-filter-hint {
  font-size: 11px;
  color: #718299;
  margin-top: 13px;
  line-height: 1.6;
}
.import-selection {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 13px;
}
.import-selection small {
  display: block;
  font-size: 11px;
  color: #a66621;
  margin-top: 5px;
}
.import-selection-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.import-selection .btn-secondary {
  font-size: 12px;
  padding: 10px 13px;
}
.import-table-wrap {
  margin-top: 18px;
}
.import-table {
  min-width: 800px;
}
.import-table th {
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.import-check-col {
  width: 65px;
  white-space: nowrap;
}
.import-table input[type="checkbox"] {
  width: 18px;
  height: 18px;
  accent-color: #285fc0;
  cursor: pointer;
}
.import-table .is-selected {
  background: #f0f5ff;
}
.import-object {
  max-width: 380px;
  min-width: 220px;
}
.import-object strong {
  display: block;
  font-size: 13px;
  line-height: 1.5;
}
.import-category {
  display: inline-block;
  font-size: 10px;
  color: #78899e;
  margin-bottom: 4px;
}
.import-table small {
  font-size: 11px;
  line-height: 1.6;
  color: #7b8b9e;
  margin-top: 5px;
}
.import-params strong {
  font-size: 13px;
  white-space: nowrap;
}
.import-price {
  font-weight: 700;
  font-size: 13px;
  white-space: nowrap;
}
.import-ready {
  font-size: 11px;
  color: #397661;
  padding: 5px 8px;
  background: #eaf5ef;
  border-radius: 6px;
  white-space: nowrap;
}
.import-existing {
  font-size: 12px;
  color: #285fc0;
  text-decoration: underline;
}
.import-unavailable {
  font-size: 11px;
  color: #8b95a5;
  display: block;
  max-width: 170px;
}
.import-no-results {
  text-align: center;
  color: #7b8b9e;
  padding: 36px !important;
}
.import-pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 18px 0;
  font-size: 12px;
  color: #73869b;
}
.import-pagination > div {
  display: flex;
  gap: 14px;
  align-items: center;
}
.import-pagination .btn-secondary {
  font-size: 12px;
  padding: 8px 13px;
}
.import-progress,
.import-results {
  padding: 20px;
  border: 1px solid #d7e9df;
  background: #f4fbf7;
  border-radius: 12px;
  margin: 18px 0;
  font-size: 13px;
}
.import-progress progress {
  display: block;
  width: 100%;
  height: 6px;
  margin-top: 12px;
  accent-color: #2b8a66;
}
.import-results ul,
.import-error ul {
  display: grid;
  gap: 12px;
  margin-top: 14px;
  max-height: 280px;
  overflow: auto;
}
.import-results a {
  font-weight: 600;
  color: #256b55;
  text-decoration: underline;
}
.import-results p {
  font-size: 12px;
  color: #728578;
  margin-top: 5px;
}
.import-error {
  font-size: 13px;
  line-height: 1.6;
  color: #9f3636;
  background: #fff3f2;
  border: 1px solid #f4d7d4;
  border-radius: 10px;
  padding: 14px 18px;
  margin: 14px 0;
}
.import-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 60px 24px;
  border: 1px dashed #d6e0eb;
  border-radius: 14px;
  background: #ffffff70;
  color: #8797ab;
}
.import-empty h2 {
  font-weight: 600;
  font-size: 16px;
  color: #52677f;
  margin-top: 18px;
}
.import-empty p {
  font-size: 13px;
  max-width: 420px;
  margin-top: 8px;
  line-height: 1.7;
}
.import-footnote {
  font-size: 11px;
  line-height: 1.8;
  color: #7e8fa3;
  margin-top: 22px;
  max-width: 1000px;
}
.import-page button:focus-visible,
.import-page a:focus-visible {
  outline: 2px solid #3675dd;
  outline-offset: 3px;
}
@media (min-width: 1500px) {
  .import-filter-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .import-search {
    grid-column: span 2;
  }
}
@media (max-width: 1050px) {
  .import-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .import-filter-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .import-selection {
    align-items: flex-start;
    flex-direction: column;
  }
}
@media (max-width: 600px) {
  .import-heading .admin-title {
    font-size: 25px;
  }
  .import-source-card {
    flex-wrap: wrap;
    padding: 18px;
  }
  .import-source-card > .import-load-actions {
    width: 100%;
  }
  .import-source-icon {
    display: none;
  }
  .import-filters {
    padding: 18px;
  }
  .import-filter-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .import-selection-actions {
    width: 100%;
  }
  .import-selection-actions > button:last-child {
    width: 100%;
  }
  .import-pagination {
    flex-direction: column;
    align-items: flex-start;
  }
  .import-back {
    margin-bottom: 18px;
  }
}
</style>
