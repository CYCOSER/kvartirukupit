<script setup lang="ts">
import Button from "~/components/ui/button/Button.vue";
import ImageEditor from "~/components/admin/ImageEditor.vue";
import AddressMap from "~/components/admin/AddressMap.client.vue";
import { Eye, Star, FlaskConical, ImagePlus, Building2, ArrowUpRight } from "lucide-vue-next";
import { adminPropertyType, adminPropertyTypes } from "~/shared/admin-property";
import {
  statuses,
  isCoastalLocation,
  propertySchema,
  money,
  withPublicTitle,
  type PropertyInput,
  type Property,
} from "~/shared/property";
const props = defineProps<{ initial?: Property }>();
const defaults: PropertyInput = {
  title: "",
  slug: "",
  type: "complex",
  complexId: null,
  nmarketComplexId: null,
  rf39ComplexId: null,
  rf39BuildingId: null,
  location: "Калининград",
  address: "",
  latitude: null,
  longitude: null,
  price: null,
  status: "available",
  area: null,
  landArea: null,
  bedrooms: null,
  floors: null,
  readiness: "Уточняется",
  finish: "Уточняется",
  seaDistance: null,
  description: "",
  utilities: [],
  published: false,
  featured: false,
  elite: false,
  demo: false,
};
const form = reactive<PropertyInput & { seaDistance: number | null }>({
  ...defaults,
  ...props.initial,
  seaDistance: props.initial?.seaDistance ?? null,
});
const utils = ref(form.utilities.join("\n"));
const utilitiesField = useAutoResizeTextarea(() => utils.value);
const descriptionField = useAutoResizeTextarea(() => form.description);
const selectedType = computed({
  get: () => adminPropertyType(form),
  set: (value: string) => {
    form.type = value === 'complex' ? 'complex' : 'apartment';
    form.elite = value === 'elite_apartment';
  },
});
watch(() => form.type, (type) => {
  if (type !== "apartment") {
    form.elite = false;
    form.complexId = null;
  }
});
const pending = ref(false),
  notice = ref(""),
  isError = ref(false);
const images = ref(props.initial?.images.map((i) => ({ ...i })) || []);
const id = ref(props.initial?.id);
const complexes = ref<Property[]>([]);
const complexesLoaded = ref(false);
const complexesPending = ref(false);
const complexesError = ref("");
const linkedApartments = ref(props.initial?.apartments || []);
const mappingFields = ['nmarketComplexId', 'rf39ComplexId', 'rf39BuildingId'] as const;
const mappingValue = (value: string | null | undefined) => value?.trim() || null;
const savedMappings = {
  nmarketComplexId: mappingValue(form.nmarketComplexId),
  rf39ComplexId: mappingValue(form.rf39ComplexId),
  rf39BuildingId: mappingValue(form.rf39BuildingId),
};
function mergeMappings(saved: Property, previous: typeof savedMappings = savedMappings) {
  for (const field of mappingFields) {
    if (mappingValue(form[field]) === previous[field]) form[field] = saved[field] ?? null;
    savedMappings[field] = mappingValue(saved[field]);
  }
}
const selectedComplexId = computed({
  get: () => form.complexId || "",
  set: (value: string) => { form.complexId = value || null; },
});
async function loadComplexes() {
  if (complexesPending.value || complexesLoaded.value) return;
  complexesPending.value = true;
  complexesError.value = "";
  try {
    complexes.value = await $fetch<Property[]>("/api/admin/properties", { query: { type: "complex" } });
    complexesLoaded.value = true;
  } catch {
    complexesError.value = "Не удалось получить список ЖК.";
  } finally {
    complexesPending.value = false;
  }
}
onMounted(() => { if (form.type === "apartment") loadComplexes(); });
watch(() => form.type, (type) => { if (type === "apartment") loadComplexes(); });
let linkedRequest = 0;
async function refreshLinkedApartments() {
  if (!id.value) return;
  const request = ++linkedRequest;
  try {
    const saved = await $fetch<Property>("/api/admin/properties/" + id.value);
    if (request === linkedRequest) {
      linkedApartments.value = saved.apartments || [];
      mergeMappings(saved);
    }
  } catch {
    notice.value = "Не удалось обновить список связанных квартир. Обновите страницу.";
    isError.value = true;
  }
}
const uploadPending = ref(false);
const uploadInput = ref<HTMLInputElement>();
const preview = ref(false);
const card = computed(() => withPublicTitle({
  ...form,
  complex: complexes.value.find((complex) => complex.id === form.complexId && complex.published)
    || (props.initial?.complex?.published && props.initial.complex.id === form.complexId ? props.initial.complex : null),
  id: id.value || "preview",
  createdAt: "",
  updatedAt: "",
  images: images.value,
  sourceId: props.initial?.sourceId ?? null,
  sourceUrl: props.initial?.sourceUrl ?? null,
  sourceName: props.initial?.sourceName ?? null,
  sourceMode: props.initial?.sourceMode ?? null,
  sourceNote: props.initial?.sourceNote ?? null,
  sourceFetchedAt: props.initial?.sourceFetchedAt ?? null,
  developer: props.initial?.developer ?? null,
  district: props.initial?.district ?? null,
  completionDate: props.initial?.completionDate ?? null,
  constructionStatus: props.initial?.constructionStatus ?? null,
  priceKind: props.initial?.priceKind ?? null,
  priceSourceUrl: props.initial?.priceSourceUrl ?? null,
  priceArea: props.initial?.priceArea ?? null,
}));
async function save() {
  pending.value = true;
  notice.value = "";
  isError.value = false;
  form.utilities = utils.value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  form.nmarketComplexId = form.nmarketComplexId?.trim() || null;
  form.rf39ComplexId = form.rf39ComplexId?.trim() || null;
  form.rf39BuildingId = form.rf39BuildingId?.trim() || null;
  const parsed = propertySchema.safeParse(form);
  if (!parsed.success) {
    notice.value =
      "Проверьте поля: " +
      parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    isError.value = true;
    pending.value = false;
    return;
  }
  try {
    const submittedMappings = {
      nmarketComplexId: mappingValue(form.nmarketComplexId),
      rf39ComplexId: mappingValue(form.rf39ComplexId),
      rf39BuildingId: mappingValue(form.rf39BuildingId),
    };
    const body = { ...parsed.data };
    // Preserve source IDs discovered by a search while this editor was open.
    if (id.value) for (const field of mappingFields) {
      if (submittedMappings[field] === savedMappings[field]) delete body[field];
    }
    const p = await $fetch<Property>(
      "/api/admin/properties" + (id.value ? "/" + id.value : ""),
      { method: id.value ? "PUT" : "POST", body },
    );
    linkedRequest++;
    mergeMappings(p, submittedMappings);
    if (id.value) {
      await saveGallery();
      if (form.type === 'complex') await refreshLinkedApartments();
    }
    else {
      await navigateTo("/admin-console-9Xk6uiIs/properties/" + p.id);
      return;
    }
    notice.value = "Объект сохранён.";
  } catch (e: any) {
    notice.value =
      e.status === 409
        ? "Такой адрес страницы уже существует. Измените адрес страницы."
        : e.data?.data?.message || e.data?.message || "Не удалось сохранить объект.";
    isError.value = true;
  } finally {
    pending.value = false;
  }
}
async function saveGallery() {
  await $fetch("/api/admin/properties/" + id.value + "/images", {
    method: "PUT",
    body: images.value.map((i) => ({ id: i.id, alt: i.alt })),
  });
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  if (!id.value || !files.length) return;
  uploadPending.value = true;
  notice.value = "";
  try {
    for (const file of files) {
      if (file.size > 10485760) throw new Error("size");
      const body = new FormData();
      body.set("file", file);
      body.set("alt", form.title || "Фото объекта");
      const img = await $fetch<Property["images"][number]>(
        "/api/admin/properties/" + id.value + "/images",
        { method: "POST", body },
      );
      images.value.push(img);
    }
    notice.value = "Фотографии загружены.";
  } catch {
    notice.value =
      "Не удалось загрузить файл. Допустимы JPEG, PNG, WebP до 10 МБ, не более 100 фото.";
    isError.value = true;
  } finally {
    uploadPending.value = false;
    input.value = "";
  }
}
function move(index: number, offset: number) {
  const target = index + offset;
  if (target < 0 || target >= images.value.length) return;
  const list = [...images.value];
  [list[index], list[target]] = [list[target]!, list[index]!];
  images.value = list;
}
</script>
<template>
  <div>
    <div class="admin-actions mb-5">
      <NuxtLink to="/admin-console-9Xk6uiIs/properties" class="btn-secondary"
        >← Все объекты</NuxtLink
      ><button class="btn-secondary" @click="preview = !preview">
        {{ preview ? "Закрыть предпросмотр" : "Предпросмотр карточки" }}</button
      ><NuxtLink
        v-if="initial?.published"
        :to="'/catalog/' + initial.slug"
        target="_blank"
        class="btn-secondary"
        >На сайте ↗</NuxtLink
      >
    </div>
    <PropertyPanels v-if="preview" compact class="property-card-preview mb-8" data-testid="property-card-preview">
      <PropertyCard class="catalog-panel" :property="card" :show-arrow="false" />
    </PropertyPanels>
    <details v-if="initial?.sourceUrl" class="source-notice mb-6">
      <summary>Источник: {{ initial.sourceName || "Сайт проекта" }}</summary>
      <p>
        <a
          :href="initial.sourceUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="underline"
          >Открыть исходную карточку ↗</a
        >
        <span v-if="initial.sourceFetchedAt">
          · Проверено
          {{
            new Date(initial.sourceFetchedAt).toLocaleString("ru-RU", {
              timeZone: "Europe/Kaliningrad",
            })
          }}</span
        >
      </p>
      <p v-if="initial.sourceNote">{{ initial.sourceNote }}</p>
      <p v-if="initial.priceKind === 'example'">
        Указана цена примера квартиры из источника. Это не минимальная цена ЖК.
      </p>
    </details>
    <p
      v-if="notice"
      :class="isError ? 'error-text mb-5' : 'toast'"
      :role="isError ? 'alert' : 'status'"
    >
      {{ notice }}
    </p>
    <form class="admin-form" @submit.prevent="save">
      <label
        >Название<input
          v-model="form.title"
          required
          minlength="3"
          maxlength="500" /></label
      ><label
        >Адрес страницы<input
          v-model="form.slug"
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          placeholder="zhk-v-kaliningrade"
          maxlength="120" /></label
      ><label
        >Тип<AppSelect v-model="selectedType" aria-label="Тип объекта">
          <AppSelectOption
            v-for="(label, value) in adminPropertyTypes"
            :key="value"
            :value="value"
          >
            {{ label }}
          </AppSelectOption>
        </AppSelect></label
      ><label v-if="form.type === 'apartment'">
        <span class="property-complex-label">Жилой комплекс квартиры<NuxtLink v-if="form.complexId" :to="'/admin-console-9Xk6uiIs/properties/' + form.complexId" target="_blank" rel="noopener" class="property-complex-link"><Building2 :size="14" aria-hidden="true" />Карточка ЖК<ArrowUpRight :size="14" aria-hidden="true" /></NuxtLink></span>
        <AppSelect v-model="selectedComplexId" :disabled="complexesPending" aria-label="Жилой комплекс квартиры">
          <AppSelectOption value="">Без привязки к ЖК</AppSelectOption>
          <AppSelectOption v-for="complex in complexes" :key="complex.id" :value="complex.id">
            {{ complex.title }} · {{ complex.location }}{{ complex.published ? "" : " · Черновик" }}
          </AppSelectOption>
        </AppSelect>
        <span v-if="complexesPending" class="text-sm text-slate-500" role="status">Загружаем жилые комплексы…</span>
        <span v-if="complexesError" class="error-text" role="alert">{{ complexesError }} <button type="button" class="underline" @click="loadComplexes">Повторить</button></span>
      </label><label
        >Локация<input
          v-model="form.location"
          required
          maxlength="150" /></label
      ><label
        >Адрес<input
          v-model="form.address"
          maxlength="2000"
          placeholder="Улица и номер дома" /></label>
      <ClientOnly><AddressMap v-model:latitude="form.latitude" v-model:longitude="form.longitude" class="full" :address="form.address" :location="form.location" /></ClientOnly>
      <label
        >Цена, ₽ (пусто — по запросу)<NumberField
          v-model="form.price"
          numeric
          nullable
          :increment="300000"
          control-label="цену объекта"
          min="0"
          max="2000000000" /></label
      ><label
        >Статус<AppSelect v-model="form.status">
          <AppSelectOption
            v-for="(label, value) in statuses"
            :key="value"
            :value="value"
          >
            {{ label }}
          </AppSelectOption>
        </AppSelect></label
      ><label
        >Площадь квартиры, м²<NumberField
          v-model="form.area"
          numeric
          nullable
          :increment="1"
          control-label="площадь квартиры"
          min="1"
          max="10000" /></label
      ><label
        >Комнаты (0 — студия; пусто — неизвестно)<NumberField
          v-model="form.bedrooms"
          numeric
          nullable
          :increment="1"
          control-label="количество комнат"
          min="0"
          max="100" /></label
      ><label
        >Этажность<NumberField
          v-model="form.floors"
          numeric
          nullable
          :increment="1"
          control-label="этажность"
          min="1"
          max="100" /></label
      ><label
        >Готовность<input
          v-model="form.readiness"
          required
          maxlength="100" /></label
      ><label
        >Отделка<input v-model="form.finish" required maxlength="100" /></label
      ><label v-if="isCoastalLocation(form.location)"
        >До моря, метров (необязательно)<NumberField
          v-model="form.seaDistance"
          numeric
          nullable
          :increment="100"
          control-label="расстояние до моря"
          min="0"
          max="100000" /></label
      ><label
        >Особенности ЖК (по одной на строку)<textarea
          ref="utilitiesField"
          v-model="utils"
          rows="3"
        /></label
      ><label class="full"
        >Описание<textarea
          ref="descriptionField"
          v-model="form.description"
          maxlength="30000"
          rows="7"
        />
      </label>
      <fieldset class="full property-options" data-testid="property-options">
        <legend>Размещение объекта</legend>
        <div class="property-option-grid">
          <label class="property-option" :class="{ 'is-selected': form.published }">
            <span class="property-option-icon" aria-hidden="true"><Eye :size="20" /></span>
            <span class="property-option-copy"><strong>Опубликован</strong></span>
            <input v-model="form.published" type="checkbox" aria-label="Опубликован" />
          </label>
          <label class="property-option" :class="{ 'is-selected': form.featured }">
            <span class="property-option-icon" aria-hidden="true"><Star :size="20" /></span>
            <span class="property-option-copy"><strong>На главной</strong></span>
            <input v-model="form.featured" type="checkbox" aria-label="На главной" />
          </label>
          <label class="property-option" :class="{ 'is-selected': form.demo }">
            <span class="property-option-icon" aria-hidden="true"><FlaskConical :size="20" /></span>
            <span class="property-option-copy"><strong>Демонстрационный объект</strong></span>
            <input v-model="form.demo" type="checkbox" aria-label="Демонстрационный объект" />
          </label>
        </div>
      </fieldset>
      <details v-if="form.type === 'complex'" class="full source-notice">
        <summary class="cursor-pointer font-semibold">Связь с ЖК в Нмаркете и CRM</summary>
        <div class="grid gap-4 sm:grid-cols-2">
          <label>ID ЖК в Нмаркете<input v-model="form.nmarketComplexId" maxlength="100" placeholder="ID ЖК из выгрузки Нмаркета" /></label>
          <label>ID ЖК в CRM RF39<input v-model="form.rf39ComplexId" maxlength="100" placeholder="ID жилого комплекса (development)" /></label>
          <label>ID корпуса в CRM RF39 (необязательно)<input v-model="form.rf39BuildingId" maxlength="100" placeholder="ID корпуса (complex), если нужен один корпус" /></label>
        </div>
      </details>
      <div class="full property-photos" data-testid="property-photos">
        <div class="property-photos-heading"><h2>Фотографии</h2><span v-if="id" class="property-photo-count" aria-label="Количество фотографий">{{ images.length }} / 100</span></div>
        <p v-if="!id" class="text-sm text-slate-500">
          Сначала сохраните объект, затем добавьте фотографии.
        </p>
        <template v-else>
          <div class="property-upload">
            <span class="property-upload-icon" aria-hidden="true"><ImagePlus :size="25" /></span>
            <div class="property-upload-copy"><span>JPEG, PNG или WebP · до 10 МБ на файл</span><p v-if="uploadPending" role="status">Загружаем фотографии…</p></div>
            <button type="button" class="btn-secondary property-upload-button" :disabled="uploadPending" @click="uploadInput?.click()"><ImagePlus :size="16" aria-hidden="true" />{{ uploadPending ? 'Загрузка…' : 'Добавить фотографии' }}</button>
            <input
              ref="uploadInput"
              class="hidden"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              tabindex="-1"
              aria-label="Файлы фотографий"
              :disabled="uploadPending"
              @change="upload"
            />
          </div>
          <div class="admin-gallery property-gallery">
            <div v-for="(image, index) in images" :key="image.id" class="property-photo-card">
              <img :src="image.file" :alt="image.alt" :class="{ 'is-plan': image.kind === 'plan' }" /><input
                v-model="image.alt"
                :aria-label="'Описание фото ' + (index + 1)"
                required
                maxlength="200"
              />
              <div class="property-photo-actions">
                <button
                  type="button"
                  class="btn-secondary"
                  :disabled="index === 0"
                  aria-label="Переместить фото раньше"
                  @click="move(index, -1)"
                >
                  ←</button
                ><button
                  type="button"
                  class="btn-secondary"
                  :disabled="index === images.length - 1"
                  aria-label="Переместить фото позже"
                  @click="move(index, 1)"
                >
                  →</button
                ><button
                  type="button"
                  class="btn-secondary text-red-700"
                  @click="images.splice(index, 1)"
                >
                  Убрать
                </button>
                <ImageEditor :property-id="id" :image="image" @updated="Object.assign(image, $event)" />
              </div>
            </div>
          </div>
          <p class="mt-4 text-sm text-slate-500">
            Порядок фото и удаление применятся после сохранения объекта.
          </p></template
        >
      </div>
      <div class="full">
        <Button type="submit" :disabled="pending || uploadPending">{{
          pending ? "Сохраняем…" : "Сохранить объект"
        }}</Button>
      </div>
    </form>
    <section v-if="id && form.type === 'complex'" class="mt-8" aria-labelledby="linked-apartments-title">
      <h2 id="linked-apartments-title" class="mb-4 text-xl font-semibold">Квартиры в этом ЖК · {{ linkedApartments.length }}</h2>
      <ComplexApartmentSearch :property-id="id" @updated="refreshLinkedApartments" />
      <div v-if="linkedApartments.length" class="admin-table-wrap mt-5">
        <table class="admin-table">
          <thead><tr><th>Квартира</th><th>Цена</th><th>Площадь</th><th>Публикация</th></tr></thead>
          <tbody><tr v-for="apartment in linkedApartments" :key="apartment.id">
            <td><NuxtLink :to="'/admin-console-9Xk6uiIs/properties/' + apartment.id" class="underline">{{ apartment.title }}</NuxtLink></td>
            <td>{{ money(apartment.price) }}</td><td>{{ apartment.area == null ? '—' : apartment.area + ' м²' }}</td>
            <td>{{ apartment.published ? 'На сайте' : 'Черновик' }}</td>
          </tr></tbody>
        </table>
      </div>
      <p v-else class="mt-5 text-sm text-slate-500">Нет связанных квартир.</p>
    </section>
  </div>
</template>
<style scoped>
.admin-form textarea { resize: none; overflow: hidden; }
.property-card-preview.property-grid { grid-template-columns: minmax(0, 1fr); width: min(100%, 320px); }
.property-complex-label { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 5px; }
.property-complex-link { display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px; border-radius: 6px; background: #edf3fc; color: #345d96; font-size: 11px; font-weight: 600; }.property-complex-link:hover { background: #dfeafa; color: #245fbd; }
.source-notice summary { cursor: pointer; font-size: 12px; font-weight: 600; }
.property-options { min-width: 0; padding: 0; border: 0; }
.property-options legend { margin-bottom: 14px; color: #273d5e; font-size: 17px; font-weight: 700; }
.property-option-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr)); gap: 12px; }
.property-option { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 16px; border: 1px solid #e0e7f1; border-radius: 12px; background: #fafbfd; cursor: pointer; transition: border-color .15s, background-color .15s; }
.property-option:hover { border-color: #b3c9e9; }
.property-option.is-selected { border-color: #98b9e8; background: #f0f6ff; }
.property-option-icon { display: grid; flex: 0 0 36px; place-items: center; width: 36px; height: 36px; border-radius: 10px; background: #eaf0f9; color: #617b9e; }
.property-option.is-selected .property-option-icon { background: #dceaff; color: #245fbd; }
.property-option-copy { display: grid; gap: 4px; flex: 1; min-width: 0; }
.property-option-copy strong { color: #273d5e; font-size: 13px; line-height: 1.35; font-weight: 650; }
.property-option-copy small { color: #71819a; font-size: 11px; line-height: 1.45; }
.property-option input[type='checkbox'] { flex: 0 0 18px; width: 18px; height: 18px; margin: 0; accent-color: #245fbd; cursor: pointer; }
.property-option:focus-within { outline: 2px solid #245fbd; outline-offset: 3px; }
.property-photos-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.property-photos-heading h2 { color: #273d5e; font-size: 20px; font-weight: 700; }
.property-photo-count { padding: 4px 10px; border-radius: 20px; background: #edf3fc; color: #53759e; font-size: 12px; font-variant-numeric: tabular-nums; }
.property-upload { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; padding: 20px; border: 1px dashed #bbcee7; border-radius: 13px; background: #f7faff; }
.property-upload-icon { display: grid; flex: 0 0 46px; place-items: center; width: 46px; height: 46px; border-radius: 12px; background: #e7f0ff; color: #3b6baa; }
.property-upload-copy { display: grid; flex: 1; gap: 5px; min-width: 0; }.property-upload-copy strong { color: #345475; font-size: 13px; }.property-upload-copy span,.property-upload-copy p { color: #71819a; font-size: 11px; line-height: 1.5; }
.property-upload-button { display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0; font-size: 12px; }
.property-gallery { grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 16px; }
.property-photo-card { min-width: 0; padding: 10px; border: 1px solid #e0e7f1; border-radius: 12px; background: #fff; }
.property-photo-card > input { font-size: 12px; }
.property-photo-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.property-photo-actions > .btn-secondary,.property-photo-actions :deep(.image-editor-trigger) { display: inline-flex; align-items: center; justify-content: center; height: 34px; min-height: 34px; margin-top: 0; margin-bottom: 0; padding: 6px 8px; font-size: 11px; line-height: 20px; border-radius: 8px; }
.property-photo-actions > .btn-secondary[aria-label] { width: 30px; padding-inline: 0; }
.property-photo-actions :deep(.image-editor-trigger) { gap: 5px; margin-left: auto; white-space: nowrap; }.property-photo-actions :deep(.image-editor-trigger svg) { width: 13px; height: 13px; }
.property-upload-button:focus-visible { outline: 2px solid #245fbd; outline-offset: 3px; }
@media (max-width: 640px) { .property-option-grid { grid-template-columns: 1fr; }.property-upload { flex-wrap: wrap; padding: 16px; }.property-upload-button { width: 100%; justify-content: center; }.property-gallery { grid-template-columns: 1fr; } }
.admin-gallery img.is-plan {
  object-fit: contain;
  background: #fff;
}
.source-notice {
  border: 1px solid #102f5030;
  background: #edf4ff;
  padding: 20px;
  color: #102f50;
  font-size: 14px;
  line-height: 1.7;
}
.source-notice p + p {
  margin-top: 8px;
}
</style>
