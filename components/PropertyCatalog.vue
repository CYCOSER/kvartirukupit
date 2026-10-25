<script setup lang="ts">
import { SlidersHorizontal, ArrowDown, ArrowUpRight, LayoutGrid, Map, Search, X } from "lucide-vue-next";
import Sheet from "~/components/ui/sheet/Sheet.vue";
import { type Property, type CatalogMapItem } from "~/shared/property";
const props = defineProps<{ elite?: boolean }>();
const route = useRoute(),
  router = useRouter();
const open = ref(false);
const mapView = computed(() => route.query.view === "map");
const selectedPropertyId = computed(() => typeof route.query.property === "string" ? route.query.property : undefined);
const catalogType = computed(() => props.elite || route.query.type === "apartment" ? "apartment" : "complex");
const titleSearch = ref(typeof route.query.q === "string" ? route.query.q : "");
const defaults = {
  type: props.elite ? "apartment" : "complex",
  location: "",
  minPrice: "",
  maxPrice: "",
  minArea: "",
  maxArea: "",
  bedrooms: "",
  status: "available",
  sort: "newest",
};
const filters = ref<Record<string, string>>({
  ...defaults,
  ...Object.fromEntries(
    Object.entries(route.query).map(([k, v]) => [k, String(v)]),
  ),
  type: catalogType.value,
});
watch(
  () => route.query,
  (query) => {
    titleSearch.value = typeof query.q === "string" ? query.q : "";
    filters.value = {
      ...defaults,
      ...Object.fromEntries(
        Object.entries(query).map(([k, v]) => [k, String(v)]),
      ),
      type: catalogType.value,
    };
  },
);
const { data, error, status, refresh } = await useFetch<{
  items: Property[] | CatalogMapItem[];
  total: number;
  locations: string[];
  pages: number;
}>(computed(() => mapView.value ? "/api/properties/map" : "/api/properties"), {
  key: computed(() => `${props.elite ? "elite" : "newbuild"}-catalog-${mapView.value ? "map" : "grid"}`),
  query: computed(() => ({
    ...route.query,
    elite: String(!!props.elite),
    type: catalogType.value,
  })),
});
const cardItems = computed(() => mapView.value ? [] : (data.value?.items || []) as Property[]);
function changeView(view: "grid" | "map") {
  if ((view === "map") === mapView.value) return;
  const query = { ...route.query };
  delete query.page;
  delete query.view;
  if (view === "map") query.view = "map";
  router.push({ query, hash: route.hash });
}
function applyTitleSearch() {
  const query = { ...route.query };
  delete query.page;
  const title = titleSearch.value.trim();
  if (title) query.q = title;
  else delete query.q;
  router.push({ query, hash: "#homes" });
}
function apply() {
  open.value = false;
  router.push({
    hash: "#homes",
    query: {
      ...Object.fromEntries(
        Object.entries(filters.value).filter(
          ([k, v]) => v !== "" && k !== "page" && k !== "view",
        ),
      ),
      ...(mapView.value ? { view: "map" } : {}),
    },
  });
}
function reset() {
  filters.value = { ...defaults };
  router.push({ query: mapView.value ? { view: "map" } : {}, hash: "#homes" });
  open.value = false;
}
const page = computed(() => Number(route.query.page || 1));
useCatalogTools(async (values) => {
  filters.value = { ...defaults, ...values };
  await router.push({ query: { ...values, ...(mapView.value ? { view: "map" } : {}) }, hash: "#homes" });
  await refresh();
  return {
    total: data.value?.total || 0,
    items:
      data.value?.items.map((p) => ({
        title: p.title,
        slug: p.slug,
        price: p.price,
      })) || [],
  };
});
</script>
<template>
  <div class="catalog-page" :class="{ 'catalog-page-elite': elite }">
    <header class="catalog-intro shell">
      <nav class="breadcrumb" aria-label="Хлебные крошки">
        <NuxtLink to="/">Главная</NuxtLink><span aria-hidden="true">/</span>
        <span aria-current="page">{{ elite ? "Элитные квартиры" : "Новостройки" }}</span>
      </nav>
      <div class="catalog-intro-grid">
        <div>
          <p v-reveal class="eyebrow">КАЛИНИНГРАД · ПРОСТРАНСТВО ДЛЯ ЖИЗНИ</p>
          <h1 v-reveal="85" class="type-pair">
            <span class="type-upright">{{ elite ? "Элитные" : "Новостройки" }}</span>
            <em class="type-script">{{ elite ? "квартиры" : "Калининграда" }}</em>
          </h1>
        </div>
        <div class="catalog-intro-note">
          <p v-reveal="170">Выберите район и планировку, которая устроит именно вас.</p>
          <a v-reveal="255" href="#homes" class="catalog-explore">
            {{ elite ? "Выбрать квартиру" : "Выбрать свою квартиру" }} <ArrowDown :size="18" aria-hidden="true" />
          </a>
        </div>
      </div>
      <div v-reveal="340" class="catalog-caption">
        <span>Калининград</span>
        <span>{{ elite ? "Элитные квартиры" : "Жилые комплексы / Квартиры" }}</span>
      </div>
    </header>

    <section
      id="homes"
      class="catalog-gallery"
      aria-labelledby="catalog-heading"
    >
      <div class="shell">
        <div class="catalog-heading">
          <div>
            <p class="eyebrow">01 / КОЛЛЕКЦИЯ</p>
            <h2 id="catalog-heading">{{ elite ? "ВЫ ДОСТОЙНЫ ЛУЧШЕГО" : "Найдите свою квартиру" }}</h2>
          </div>
          <div class="catalog-heading-actions">
            <div class="catalog-view-switch" :class="{ 'is-map': mapView }" role="group" aria-label="Вид каталога">
              <span class="catalog-view-indicator" data-testid="catalog-view-indicator" aria-hidden="true" />
              <button :aria-pressed="!mapView" @click="changeView('grid')">
                <LayoutGrid :size="16" aria-hidden="true" />Карточки
              </button>
              <button :aria-pressed="mapView" @click="changeView('map')">
                <Map :size="16" aria-hidden="true" />Карта
              </button>
            </div>
          </div>
        </div>
        <form class="catalog-title-search" data-testid="catalog-title-search" role="search" aria-label="Поиск по названию" @submit.prevent="applyTitleSearch">
          <label class="sr-only" for="catalog-title-search">Название ЖК или квартиры</label>
          <input id="catalog-title-search" v-model="titleSearch" data-testid="catalog-title-search-input" type="search" placeholder="Название ЖК или квартиры" maxlength="200" autocomplete="off" />
          <button v-if="titleSearch" type="button" class="catalog-title-clear" data-testid="catalog-title-search-clear" aria-label="Очистить поиск по названию" @click="titleSearch = ''; applyTitleSearch()"><X :size="16" aria-hidden="true" /></button>
          <button type="submit" class="catalog-title-submit" data-testid="catalog-title-search-submit" aria-label="Найти по названию"><Search :size="18" aria-hidden="true" /></button>
        </form>
        <div class="catalog-toolbar">
          <div
            class="catalog-type-links"
            role="group"
            aria-label="Тип недвижимости"
          >
            <button
              v-for="item in elite ? [{ value: 'apartment', label: 'Все квартиры' }] : [
                { value: 'complex', label: 'Жилые комплексы' },
                { value: 'apartment', label: 'Квартиры' },
              ]"
              :key="item.value"
              :aria-pressed="catalogType === item.value"
              @click="
                filters.type = item.value;
                apply();
              "
            >
              {{ item.label }}
            </button>
          </div>
          <div class="catalog-controls">
            <Sheet v-model:open="open" title="Фильтры">
              <template #trigger>
                <button class="catalog-filter-trigger">
                  <SlidersHorizontal :size="16" aria-hidden="true" /> Фильтры
                </button>
              </template>
              <CatalogFilters
                v-model="filters"
                :apartments-only="elite"
                :locations="data?.locations || []"
                @apply="apply"
                @reset="reset"
              />
            </Sheet>
            <AppSelect
              v-model="filters.sort"
              aria-label="Сортировка"
              @change="apply"
            >
              <AppSelectOption value="newest">Сначала новые</AppSelectOption>
              <AppSelectOption value="price_asc"
                >Сначала дешевле</AppSelectOption
              >
              <AppSelectOption value="price_desc"
                >Сначала дороже</AppSelectOption
              >
              <AppSelectOption value="area_asc"
                >Площадь по возрастанию</AppSelectOption
              >
              <AppSelectOption value="area_desc"
                >Площадь по убыванию</AppSelectOption
              >
            </AppSelect>
          </div>
        </div>
        <div v-if="error" class="catalog-empty">
          <p>Не удалось загрузить каталог.</p>
          <button class="catalog-inline-link" @click="refresh()">
            Повторить
          </button>
        </div>
        <ClientOnly v-else-if="mapView">
          <LazyCatalogMapView :items="data?.items || []" :busy="status === 'pending'" :selected-property-id="selectedPropertyId" />
          <template #fallback>
            <div class="catalog-empty" role="status">Карта загружается…</div>
          </template>
        </ClientOnly>
        <div v-else-if="!data?.items.length" class="catalog-empty">
          <h3>{{ elite ? "Пока нет подходящих квартир" : "Пока нет подходящих новостроек" }}</h3>
          <p>Попробуйте изменить параметры поиска.</p>
          <button class="catalog-inline-link" @click="reset">
            Сбросить фильтры
          </button>
        </div>
        <PropertyPanels v-else compact class="catalog-grid" :aria-busy="status === 'pending'">
          <PropertyCard
            v-for="property in cardItems"
            :key="property.id"
            v-reveal
            class="catalog-panel"
            :property="property"
            :show-arrow="false"
          />
        </PropertyPanels>
        <nav
          v-if="!mapView && (data?.pages || 0) > 1"
          class="pagination"
          aria-label="Страницы каталога"
        >
          <NuxtLink
            v-if="page > 1"
            :to="{ query: { ...route.query, page: page - 1 }, hash: '#homes' }"
            class="catalog-inline-link"
            >Назад</NuxtLink
          >
          <span>{{ page }} / {{ data?.pages }}</span>
          <NuxtLink
            v-if="page < (data?.pages || 0)"
            :to="{ query: { ...route.query, page: page + 1 }, hash: '#homes' }"
            class="catalog-inline-link"
            >Далее</NuxtLink
          >
        </nav>
        <div class="catalog-invitation-wrap">
          <section
            class="catalog-invitation"
            aria-labelledby="catalog-invitation-title"
          >
            <div class="catalog-invitation-copy">
              <p class="eyebrow">02 / ПЕРСОНАЛЬНЫЙ ПОДБОР</p>
              <h2 id="catalog-invitation-title" class="type-pair">
                <span class="type-upright">Индивидуальный подход</span>
                <em class="type-script">К вашим требованиям</em>
              </h2>
              <p class="catalog-invitation-description">
                Какой вы видите свою квартиру в Калининграде? Обсудим
                планировку, район и то, что важно для вашей семьи.
              </p>
              <ul class="catalog-priorities" aria-label="Что обсудим">
                <li>
                  <span aria-hidden="true">01</span>Район, транспорт и
                  инфраструктура
                </li>
                <li>
                  <span aria-hidden="true">02</span>Планировка и пространство
                  для семьи
                </li>
                <li>
                  <span aria-hidden="true">03</span>Бюджет и сроки переезда
                </li>
              </ul>
              <div class="catalog-invitation-action">
                <NuxtLink to="/#contact" class="catalog-consult">
                  <span>Обсудить подбор</span>
                  <span class="catalog-consult-arrow"
                    ><ArrowUpRight :size="22" aria-hidden="true"
                  /></span>
                </NuxtLink>
                <span>Начнём с короткого разговора</span>
              </div>
            </div>
            <div class="catalog-invitation-image">
              <img
                src="/images/backgrounds/catalog-invitation.webp"
                alt="Дорожка через дюны к морю — атмосферная иллюстрация"
                width="1672"
                height="941"
                loading="lazy"
              />
              <p>
                <span>Своё пространство<br />В ритме города</span>
                Калининград
              </p>
            </div>
          </section>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.catalog-page .catalog-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  max-width: 643px;
  margin-inline: auto;
}
@media (min-width: 860px) {
  .catalog-page .catalog-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    max-width: 966px;
  }
}
@media (min-width: 1360px) {
  .catalog-page .catalog-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    max-width: 1289px;
  }
}
@media (max-width: 600px) {
  .catalog-page .catalog-grid {
    grid-template-columns: 1fr;
    max-width: 320px;
  }
}
.catalog-page {
  position: relative;
  isolation: isolate;
  clip-path: inset(0);
  color: #f2f6fb;
  background: #163c66;
}
.catalog-page-elite {
  --catalog-background: url("/images/backgrounds/elite-interior-background.webp");
}
.catalog-page::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    linear-gradient(90deg, #0c192bd6, #0c1b2e30 76%),
    linear-gradient(0deg, #0c1b2e60, #0c1b2e10),
    var(--catalog-background, url("/images/backgrounds/catalog-background.webp")) center / cover;
}
.catalog-intro {
  padding-top: 155px;
}
.catalog-intro .breadcrumb {
  margin: 0 0 65px;
  color: #cad8eb;
  font-size: 12px;
}
.catalog-intro-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 270px;
  gap: 60px;
  align-items: end;
}
.catalog-page .eyebrow {
  color: #b0c0d5;
  font-size: 11px;
  letter-spacing: 0.14em;
}
.catalog-intro h1.type-pair {
  --script-scale: 1.1;
  --script-indent: 0.35em;
  margin: 22px 0 0;
  font-family: var(--font-display);
  font-size: clamp(56px, 6.6vw, 88px);
  line-height: 1.04;
  letter-spacing: -0.02em;
  font-weight: 500;
}
.catalog-page em {
  font-family: var(--font-display);
  font-weight: 500;
  color: #ccd6e3;
}
.catalog-intro h1 em {
  color: #ccd6e3;
}
.catalog-intro-note {
  padding: 0 0 8px 30px;
  border-left: 1px solid #ffffff40;
}
.catalog-intro-note p {
  font-size: 18px;
  line-height: 1.65;
  letter-spacing: -0.02em;
}
.catalog-explore {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
  width: fit-content;
  margin-top: 32px;
  padding-bottom: 10px;
  border-bottom: 1px solid #ffffff70;
  font-size: 12px;
}
.catalog-explore svg {
  transition: transform 200ms ease;
}
.catalog-explore:hover svg {
  transform: translateY(4px);
}
.catalog-caption {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  margin-top: 68px;
  padding: 20px 0;
  border-top: 1px solid #ffffff35;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: #cad8eb;
}
.catalog-gallery {
  border-top: 1px solid #ffffff38;
  background: linear-gradient(135deg, #163c66cc, #163c669e);
  backdrop-filter: blur(28px);
}
.catalog-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
  padding: 42px 0 28px;
}
.catalog-heading h2 {
  margin-top: 12px;
  font-size: clamp(32px, 3vw, 44px);
  line-height: 1.12;
  font-weight: 500;
  letter-spacing: -0.02em;
}
.catalog-heading-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  margin-left: auto;
  max-width: 100%;
}
.catalog-title-search { display: flex; width: 100%; min-width: 0; height: 48px; margin-bottom: 24px; padding: 3px; border: 1px solid #ffffff30; border-radius: 8px; background: #102d4c66; }
.catalog-title-search input { flex: 1; min-width: 0; width: 100%; padding: 9px 14px; border: 1px solid transparent; border-radius: 0; color: #c4d0e0; background: transparent; font-size: 13px; }
.catalog-title-search input::placeholder { color: #c4d0e0; opacity: .8; }
.catalog-title-search input:focus::placeholder { color: #58718c; }
.catalog-title-search input::-webkit-search-cancel-button { appearance: none; }
.catalog-title-search button { display: grid; place-items: center; flex-shrink: 0; width: 42px; border-radius: 5px; }
.catalog-title-clear { color: #c4d0e0; background: transparent; }
.catalog-title-submit { color: #173a60; background: #dce7f3; }
.catalog-title-submit:hover { background: #eaf1f8; }
.catalog-view-switch {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  width: 216px;
  padding: 3px;
  border: 1px solid #ffffff30;
  border-radius: 8px;
  background: #102d4c66;
}
.catalog-view-indicator {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 3px;
  width: calc((100% - 6px) / 2);
  border-radius: 5px;
  background: #dce7f3;
  pointer-events: none;
  transition: transform 260ms cubic-bezier(.22, .68, .3, 1);
}
.catalog-view-switch.is-map .catalog-view-indicator { transform: translateX(100%); }
.catalog-view-switch button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 38px;
  padding: 8px 12px;
  border-radius: 5px;
  color: #c4d0e0;
  font-size: 12px;
  background: transparent;
  transition: color 160ms;
}
.catalog-view-switch button[aria-pressed="true"] {
  color: #173a60;
}
.catalog-view-switch button:hover {
  color: #fff;
}
.catalog-view-switch button[aria-pressed="true"]:hover {
  color: #173a60;
}
.catalog-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  border-top: 1px solid #ffffff28;
  margin-bottom: 24px;
}
.catalog-type-links,
.catalog-controls {
  display: flex;
  align-items: center;
}
.catalog-type-links {
  gap: 28px;
}
.catalog-type-links button {
  position: relative;
  min-height: 64px;
  padding: 10px 0;
  color: #b4c3d7;
  font-size: 12px;
  white-space: nowrap;
  transition: color 180ms ease;
}
.catalog-type-links button::after {
  content: "";
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 2px;
  background: #ccd6e3;
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 180ms ease;
}
.catalog-type-links button:hover,
.catalog-type-links button[aria-pressed="true"] {
  color: #f2f6fb;
}
.catalog-type-links button[aria-pressed="true"]::after {
  transform: scaleX(1);
}
.catalog-controls {
  gap: 20px;
}
.catalog-filter-trigger {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 10px 0;
  font-size: 12px;
}
.catalog-controls :deep(.select-field) {
  width: 215px;
  min-height: 44px;
  padding: 10px 12px 10px 20px;
  border: 1px solid transparent;
  border-left-color: #ffffff28;
  border-radius: 0;
  background: transparent;
  color: #cad8eb;
  font-size: 12px;
}
.catalog-controls :deep(.select-field:hover),
.catalog-filter-trigger:hover {
  color: #ccd6e3;
}
.catalog-page button:not(.select-field):focus-visible,
.catalog-page a:focus-visible {
  outline: 1px solid #ccd6e3 !important;
  outline-offset: 5px;
}
.catalog-empty {
  padding: 80px 24px;
  text-align: center;
  border-block: 1px solid #ffffff28;
}
.catalog-empty h3 {
  font-size: 26px;
  font-weight: 400;
}
.catalog-empty p {
  margin: 12px 0;
  color: #c4d0e0;
}
.catalog-inline-link {
  display: inline-block;
  padding: 12px 0 8px;
  border-bottom: 1px solid #b0c0d5;
  font-size: 14px;
}
.catalog-invitation-wrap {
  padding: 72px 0 72px;
}
.catalog-invitation {
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  color: #163c66;
  background: #dde6f2;
}
.catalog-invitation-copy {
  min-width: 0;
  container-type: inline-size;
  padding: clamp(32px, 4.2vw, 60px);
}
.catalog-invitation .eyebrow {
  color: #4f6c92;
}
.catalog-page .catalog-invitation h2.type-pair {
  --script-color: #476184;
  --script-scale: 1.2;
  --script-indent: 0.25em;
  margin: 28px 0 0;
  font-size: clamp(20px, 9cqw, 46px);
  line-height: 1.15;
  font-weight: 400;
  letter-spacing: 0;
}
.catalog-invitation h2 em {
  font-family: var(--font-script);
  color: #55759f;
  font-weight: 400;
}
.catalog-invitation-description {
  max-width: 420px;
  margin: 28px 0 0;
  color: #476184;
  font-size: 14px;
  line-height: 1.8;
}
.catalog-priorities {
  display: grid;
  margin-top: 28px;
  border-block: 1px solid #163c6626;
  color: #1e4373;
  font-size: 12px;
}
.catalog-priorities li {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 12px 0;
}
.catalog-priorities li + li {
  border-top: 1px solid #163c6614;
}
.catalog-priorities li > span {
  color: #55759f;
  font-size: 10px;
}
.catalog-invitation-action {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px 18px;
  margin-top: 28px;
}
.catalog-invitation-action > span {
  max-width: 130px;
  color: #486386;
  font-size: 11px;
  line-height: 1.6;
}
.catalog-consult {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  min-height: 52px;
  background: #163c66;
  color: #dde6f2;
  font-size: 12px;
  transition: background 200ms ease;
}
.catalog-consult > span:first-child {
  padding: 0 24px;
}
.catalog-consult-arrow {
  display: grid;
  place-items: center;
  align-self: stretch;
  width: 52px;
  border-left: 1px solid #dde6f230;
}
.catalog-consult:hover {
  background: #384d68;
}
.catalog-page .catalog-consult:focus-visible {
  outline: 2px solid #163c66 !important;
  outline-offset: 4px;
}
.catalog-consult svg {
  transition: transform 200ms ease;
}
.catalog-consult:hover svg {
  transform: translate(3px, -3px);
}
.catalog-invitation-image {
  position: relative;
  min-height: 100%;
  overflow: hidden;
  background: #1e4271;
}
.catalog-invitation-image img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 44% center;
}
.catalog-invitation-image::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(0deg, #0c1b2ecc, transparent 50%);
}
.catalog-invitation-image p {
  position: absolute;
  z-index: 1;
  inset: auto 36px 30px;
  color: #dde6f2;
  font-size: 11px;
  line-height: 1.7;
}
.catalog-invitation-image p span {
  display: block;
  margin-bottom: 14px;
  font-family: var(--font-display);
  font-size: clamp(24px, 2.5vw, 34px);
  line-height: 1.3;
}
@media (max-width: 1050px) {
  .catalog-intro-grid {
    grid-template-columns: minmax(0, 1fr) 220px;
    gap: 30px;
  }
  .catalog-intro-note {
    padding-left: 24px;
  }
  .catalog-type-links {
    gap: 22px;
  }
  .catalog-controls {
    gap: 14px;
  }
  .catalog-controls :deep(.select-field) {
    width: 185px;
    padding-left: 14px;
  }
}
@media (max-width: 800px) {
  .catalog-invitation {
    grid-template-columns: 1fr;
  }
  .catalog-invitation-image {
    min-height: 300px;
  }
  .catalog-intro {
    padding-top: 130px;
  }
  .catalog-intro .breadcrumb {
    margin-bottom: 46px;
  }
  .catalog-intro-grid {
    grid-template-columns: 1fr;
    gap: 34px;
  }
  .catalog-intro h1.type-pair {
    font-size: clamp(42px, 7.6vw, 64px);
  }
  .catalog-intro-note {
    display: flex;
    justify-content: space-between;
    align-items: end;
    gap: 24px;
    border-left: 0;
    padding: 0;
  }
  .catalog-intro-note p {
    font-size: 15px;
  }
  .catalog-explore {
    margin-top: 0;
  }
  .catalog-caption {
    margin-top: 44px;
    font-size: 11px;
  }
  .catalog-caption span:last-child {
    display: none;
  }
  .catalog-heading {
    padding-top: 32px;
  }
  .catalog-toolbar {
    flex-wrap: wrap;
    gap: 0;
  }
  .catalog-type-links {
    justify-content: space-between;
    width: 100%;
  }
  .catalog-type-links button {
    min-height: 54px;
  }
  .catalog-controls {
    justify-content: space-between;
    width: 100%;
    padding-top: 8px;
    border-top: 1px solid #ffffff28;
  }
  .catalog-controls :deep(.select-field) {
    width: 225px;
    border-left-color: transparent;
  }
}
@media (max-width: 540px) {
  .catalog-intro .breadcrumb {
    margin-bottom: 34px;
  }
  .catalog-intro h1.type-pair {
    font-size: clamp(32px, 9vw, 48px);
  }
  .catalog-intro-note {
    flex-wrap: wrap;
    gap: 20px;
  }
  .catalog-intro-note p {
    font-size: 14px;
  }
  .catalog-explore {
    gap: 12px;
    font-size: 12px;
  }
  .catalog-caption {
    font-size: 11px;
    letter-spacing: 0.03em;
  }
  .catalog-heading {
    align-items: start;
  }
  .catalog-heading h2 {
    max-width: 230px;
    font-size: 32px;
  }
  .catalog-type-links {
    gap: 12px;
  }
  .catalog-type-links button {
    font-size: 12px;
  }
  .catalog-controls :deep(.select-field) {
    width: 205px;
    font-size: 12px;
  }
  .catalog-filter-trigger {
    font-size: 12px;
    gap: 8px;
  }
  .catalog-invitation-wrap {
    padding: 44px 0;
  }
  .catalog-invitation-copy {
    padding: 28px 24px;
  }
  .catalog-page .catalog-invitation h2.type-pair {
    --script-scale: 1;
    --script-indent: 0;
  }
  .catalog-invitation-description {
    font-size: 13px;
  }
  .catalog-invitation-image {
    min-height: 270px;
  }
  .catalog-invitation-image p {
    inset: auto 24px 22px;
  }
  .catalog-invitation-image p span {
    font-size: 21px;
  }
  .catalog-consult {
    width: 100%;
  }
  .catalog-invitation-action > span {
    max-width: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .catalog-view-indicator { transition: none; }
  .catalog-page *,
  .catalog-type-links button::after {
    transition: none;
  }
}
</style>
