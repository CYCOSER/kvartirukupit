<script setup lang="ts">
import { MapPin, RotateCw, Search, X } from "lucide-vue-next";
import type { CatalogMapItem } from "~/shared/property";
import { sortByAddressDistance, type MapSearchResult } from "~/shared/map-search";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";

const props = withDefaults(defineProps<{ items: CatalogMapItem[]; busy?: boolean; selectedPropertyId?: string }>(), {
  busy: false,
});
const canvas = ref<HTMLElement>();
const results = ref<HTMLElement>();
const selectedId = ref<string>();
const expandedId = ref<string>();
const loading = ref(true);
const loadError = ref(false);
const tileError = ref(false);
const searchQuery = ref("");
const searchResults = ref<MapSearchResult[]>([]);
const selectedAddress = ref<MapSearchResult>();
const visibleItems = computed(() => sortByAddressDistance(props.items, selectedAddress.value));
const searchPending = ref(false);
const searchMessage = ref("");
const locatedCount = computed(() => props.items.filter(hasCoordinates).length);
let L: typeof Leaflet | undefined;
let map: Leaflet.Map | undefined;
let basemap: Leaflet.TileLayer | undefined;
let clusters: Leaflet.MarkerClusterGroup | undefined;
let resizeObserver: ResizeObserver | undefined;
let resizeFrame = 0;
let markerFrame = 0;
let disposed = false;
let searchMarker: Leaflet.Marker | undefined;
let searchController: AbortController | undefined;
let searchVersion = 0;
let appliedSelection: string | undefined;
const markers = new Map<string, Leaflet.Marker>();

function hasCoordinates(item: CatalogMapItem): item is CatalogMapItem & { latitude: number; longitude: number } {
  return item.latitude != null && item.longitude != null;
}

function resetAddressSearch() {
  searchController?.abort();
  searchController = undefined;
  searchVersion++;
  searchResults.value = [];
  selectedAddress.value = undefined;
  searchMessage.value = "";
  searchPending.value = false;
  searchMarker?.remove();
  searchMarker = undefined;
}

watch(searchQuery, resetAddressSearch, { flush: "sync" });

async function searchAddress() {
  const query = searchQuery.value.trim();
  if (query.length < 3 || query.length > 200 || loading.value || loadError.value) return;
  resetAddressSearch();
  const version = searchVersion;
  const controller = new AbortController();
  searchController = controller;
  searchPending.value = true;
  try {
    const response = await $fetch<{ items: MapSearchResult[] }>("/api/map/search", {
      query: { q: query },
      signal: controller.signal,
    });
    if (disposed || version !== searchVersion) return;
    searchResults.value = response.items;
    if (!response.items.length) searchMessage.value = "Адрес не найден. Уточните город, улицу или номер дома.";
  } catch {
    if (!disposed && version === searchVersion && !controller.signal.aborted) {
      searchMessage.value = "Не удалось найти адрес. Попробуйте ещё раз.";
    }
  } finally {
    if (!disposed && version === searchVersion) searchPending.value = false;
  }
}

function chooseAddress(address: MapSearchResult) {
  if (!map || !L) return;
  resetAddressSearch();
  selectedAddress.value = address;
  void nextTick(() => results.value?.scrollTo({ top: 0, behavior: "auto" }));
  const label = document.createElement("span");
  label.textContent = address.label;
  searchMarker = L.marker([address.latitude, address.longitude], {
    icon: L.divIcon({
      className: "catalog-map-search-pin",
      html: '<span aria-hidden="true"></span>',
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    }),
    title: address.label,
    zIndexOffset: 2000,
  }).addTo(map).bindPopup(label);
  if (address.bounds) {
    const [south, west, north, east] = address.bounds;
    map.fitBounds([[south, west], [north, east]], { padding: [40, 40], maxZoom: 17, animate: false });
  } else {
    map.setView([address.latitude, address.longitude], 17, { animate: false });
  }
}

function clearAddressSearch() {
  searchQuery.value = "";
  resetAddressSearch();
}

function markerIcon(selected: boolean) {
  return L!.divIcon({
    className: `catalog-map-pin${selected ? " is-selected" : ""}`,
    html: '<span class="catalog-map-pin-body"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M5 21V4h9v17M14 10h5v11M3 21h18M8 8h3m-3 4h3m-3 4h3m6-2h0m0 3h0"/></svg></span>',
    iconSize: [36, 46],
    iconAnchor: [18, 44],
  });
}

function updateMarker(id: string | undefined) {
  if (!id) return;
  const marker = markers.get(id);
  if (!marker) return;
  marker.setIcon(markerIcon(id === selectedId.value));
  marker.setZIndexOffset(id === selectedId.value ? 1000 : 0);
  labelMarker(marker, id);
}

function labelMarker(marker: Leaflet.Marker, id: string) {
  const icon = marker.getElement();
  if (!icon) return;
  icon.dataset.propertyId = id;
  icon.setAttribute("aria-pressed", String(id === selectedId.value));
  icon.setAttribute("aria-label", `Выбрать: ${marker.options.title}`);
}

function keepMarkerCentral(marker: Leaflet.Marker, activeMap: Leaflet.Map) {
  const size = activeMap.getSize();
  const point = activeMap.latLngToContainerPoint(marker.getLatLng());
  const halfSquare = Math.min(size.x, size.y) * 0.2;
  if (Math.abs(point.x - size.x / 2) > halfSquare || Math.abs(point.y - size.y / 2) > halfSquare) {
    activeMap.panTo(marker.getLatLng(), {
      animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
  }
}

function focusItem(id: string) {
  const marker = markers.get(id);
  if (!marker || !map || !clusters) return;
  const activeMap = map;
  const activeClusters = clusters;
  if (activeMap.hasLayer(marker)) {
    keepMarkerCentral(marker, activeMap);
    return;
  }
  if (!clusters.hasLayer(marker)) clusters.addLayer(marker);
  clusters.zoomToShowLayer(marker, () => {
    // Without animation, the plugin's zoomend cleanup can undo spiderfying in this stack.
    queueMicrotask(() => {
      if (disposed || clusters !== activeClusters || selectedId.value !== id) return;
      if (!activeMap.hasLayer(marker)) {
        const parent = activeClusters.getVisibleParent(marker);
        if (parent instanceof L!.MarkerCluster) parent.spiderfy();
      }
      if (activeMap.hasLayer(marker)) keepMarkerCentral(marker, activeMap);
    });
  });
}

async function selectItem(id: string) {
  const previous = selectedId.value;
  selectedId.value = id;
  expandedId.value = id;
  updateMarker(previous);
  updateMarker(id);
  clusters?.refreshClusters();
  focusItem(id);
  await nextTick();
  if (disposed || selectedId.value !== id) return;
  scrollExpandedIntoView();
}

function scrollExpandedIntoView() {
  const list = results.value;
  const card = list?.querySelector<HTMLElement>(".property-card.is-expanded");
  if (!list || !card) return;
  const bounds = list.getBoundingClientRect();
  const cardBounds = card.getBoundingClientRect();
  const top = cardBounds.top - bounds.top;
  const offset = top < 0 || cardBounds.height > list.clientHeight
    ? top
    : Math.max(0, cardBounds.bottom - bounds.bottom);
  if (Math.abs(offset) > 1) list.scrollBy({ top: offset, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

function toggleItem(id: string) {
  if (expandedId.value === id) expandedId.value = undefined;
  else selectItem(id);
}

function applyRequestedSelection() {
  const id = props.selectedPropertyId;
  if (!id || id === appliedSelection || !props.items.some(item => item.id === id)) return;
  appliedSelection = id;
  void selectItem(id);
}

watch(() => props.selectedPropertyId, () => {
  appliedSelection = undefined;
  applyRequestedSelection();
});

function renderMarkers() {
  if (!map || !L) return;
  cancelAnimationFrame(markerFrame);
  if (clusters) map.removeLayer(clusters);
  markers.clear();
  clusters = L.markerClusterGroup({
    maxClusterRadius: 48,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    iconCreateFunction(cluster) {
      const selected = cluster.getAllChildMarkers().includes(markers.get(selectedId.value || "")!);
      return L!.divIcon({
        className: `catalog-map-cluster${selected ? " is-selected" : ""}`,
        html: `<span>${cluster.getChildCount()}</span>`,
        iconSize: [42, 42],
      });
    },
  });
  const points: Leaflet.LatLngTuple[] = [];
  for (const item of props.items) {
    if (!hasCoordinates(item)) continue;
    const position: Leaflet.LatLngTuple = [item.latitude, item.longitude];
    points.push(position);
    const marker = L.marker(position, {
      title: item.title,
      icon: markerIcon(item.id === selectedId.value),
      zIndexOffset: item.id === selectedId.value ? 1000 : 0,
      keyboard: true,
    });
    marker.on("click", () => selectItem(item.id));
    marker.on("add", () => labelMarker(marker, item.id));
    markers.set(item.id, marker);
  }
  map.addLayer(clusters);
  const group = clusters;
  const pendingMarkers = [...markers.values()];
  let offset = 0;
  // Plugin chunk timers cannot be cancelled when filters change or the view closes.
  const addBatch = () => {
    group.addLayers(pendingMarkers.slice(offset, offset + 200));
    offset += 200;
    if (offset < pendingMarkers.length) markerFrame = requestAnimationFrame(addBatch);
  };
  addBatch();
  if (points.length) {
    map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 15, animate: false });
  } else {
    map.setView([54.7104, 20.4522], 11, { animate: false });
  }
  if (expandedId.value) focusItem(expandedId.value);
}

watch(() => props.items, (items) => {
  if (!items.some((item) => item.id === selectedId.value)) {
    selectedId.value = (items.find(hasCoordinates) || items[0])?.id;
  }
  if (!items.some((item) => item.id === expandedId.value)) expandedId.value = undefined;
  renderMarkers();
  applyRequestedSelection();
}, { immediate: true });

async function initializeMap() {
  loading.value = true;
  loadError.value = false;
  tileError.value = false;
  try {
    const leaflet = await import("leaflet");
    // Markercluster extends a mutable global; retain it across catalog view switches.
    const runtime = window as typeof window & { L?: typeof Leaflet };
    runtime.L ||= { ...leaflet };
    await import("leaflet.markercluster");
    if (disposed || !canvas.value) return;
    L = runtime.L;
    map = L.map(canvas.value, { scrollWheelZoom: true, zoomControl: true });
    map.attributionControl.setPrefix(false);
    map.zoomControl.setPosition("bottomleft");
    map.setView([54.7104, 20.4522], 11);
    let failedTiles = 0;
    let loadedTiles = 0;
    basemap = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
    })
      .on("loading", () => { failedTiles = 0; loadedTiles = 0; })
      .on("tileload", () => { loadedTiles++; tileError.value = false; })
      .on("tileerror", () => { if (++failedTiles >= 3 && loadedTiles === 0) tileError.value = true; })
      .addTo(map);
    renderMarkers();
    resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => map?.invalidateSize({ animate: false }));
    });
    resizeObserver.observe(canvas.value);
  } catch {
    loadError.value = true;
    map?.remove();
    map = undefined;
    basemap = undefined;
  } finally {
    loading.value = false;
  }
}

function retryBasemap() {
  tileError.value = false;
  basemap?.redraw();
}

onMounted(initializeMap);
onBeforeUnmount(() => {
  disposed = true;
  resetAddressSearch();
  cancelAnimationFrame(resizeFrame);
  cancelAnimationFrame(markerFrame);
  resizeObserver?.disconnect();
  map?.remove();
  markers.clear();
});
</script>

<template>
  <section class="catalog-map-view" data-testid="catalog-map" :aria-busy="busy">
    <div class="catalog-map-area">
      <div ref="canvas" class="catalog-map-canvas" data-testid="catalog-map-canvas" role="region" aria-label="Карта объектов" />
      <div v-if="loading || loadError" class="catalog-map-placeholder" role="status">
        <MapPin :size="30" aria-hidden="true" />
        <p>{{ loading ? "Загружаем карту…" : "Не удалось загрузить карту" }}</p>
        <button v-if="loadError" type="button" @click="initializeMap"><RotateCw :size="15" aria-hidden="true" />Попробовать снова</button>
      </div>
      <div v-else-if="tileError" class="catalog-map-notice" role="status"><p>Не удалось загрузить карту. Вы можете выбрать объект в списке.</p><button type="button" @click="retryBasemap"><RotateCw :size="14" aria-hidden="true" />Попробовать снова</button></div>
      <p v-else-if="!locatedCount" class="catalog-map-notice" role="status">
        {{ items.length ? "Местоположение объектов уточняется. Все предложения — в списке." : "По выбранным фильтрам объекты не найдены." }}
      </p>
      <span v-if="busy" class="catalog-map-updating" role="status">Обновляем объекты…</span>
    </div>
    <aside class="catalog-map-sidebar" aria-label="Объекты на карте">
      <form class="catalog-map-search" data-testid="catalog-map-search-form" role="search" aria-label="Поиск адреса на карте" @submit.prevent="searchAddress">
        <div class="catalog-map-search-controls">
          <label class="sr-only" for="catalog-map-address">Адрес на карте</label>
          <input id="catalog-map-address" v-model="searchQuery" data-testid="catalog-map-search-input" type="search" placeholder="Найти адрес на карте" minlength="3" maxlength="200" autocomplete="off" required />
          <button v-if="searchQuery" type="button" class="catalog-map-search-clear" data-testid="catalog-map-search-clear" aria-label="Очистить поиск" @click="clearAddressSearch"><X :size="17" aria-hidden="true" /></button>
          <button type="submit" class="catalog-map-search-submit" data-testid="catalog-map-search-submit" aria-label="Найти адрес" :disabled="searchPending || loading || loadError || searchQuery.trim().length < 3"><Search :size="18" aria-hidden="true" /></button>
        </div>
        <ul v-if="searchResults.length" class="catalog-map-search-results" data-testid="catalog-map-search-results" aria-label="Найденные адреса">
          <li v-for="address in searchResults" :key="address.id"><button type="button" data-testid="catalog-map-search-result" @click="chooseAddress(address)"><MapPin :size="15" aria-hidden="true" /><span>{{ address.label }}</span></button></li>
        </ul>
        <p v-if="searchPending || searchMessage" class="catalog-map-search-status" data-testid="catalog-map-search-status" role="status">{{ searchPending ? "Ищем адрес…" : searchMessage }}</p>
      </form>
      <div ref="results" class="catalog-map-results" data-testid="catalog-map-results" tabindex="0" aria-label="Список объектов">
        <p v-if="!items.length" class="catalog-map-empty">Попробуйте изменить фильтры.</p>
        <PropertyPanels class="catalog-map-panels">
          <article v-for="item in visibleItems" :key="item.id" class="catalog-map-item" :class="{ 'is-selected': item.id === selectedId }" data-testid="catalog-map-item" :data-property-id="item.id" :data-selected="item.id === selectedId" :data-expanded="item.id === expandedId" @transitionend="$event.propertyName === 'min-height' && scrollExpandedIntoView()">
            <PropertyCard :property="item" :show-arrow="false" :disclosure="{ expanded: item.id === expandedId, id: 'catalog-map-panel-' + item.id }" class="catalog-panel" @toggle="toggleItem(item.id)">
              <template #details><p v-if="!hasCoordinates(item)" class="catalog-map-unlocated">Местоположение уточняется</p></template>
            </PropertyCard>
          </article>
        </PropertyPanels>
      </div>
    </aside>
  </section>
</template>

<style scoped>
.catalog-map-view { display: grid; grid-template-columns: minmax(0, 1fr) 320px; height: min(720px, 78vh); min-height: 480px; overflow: hidden; border: 0; border-radius: 0; background: #102f50; color: #193c56; }
.catalog-map-area { position: relative; min-width: 0; isolation: isolate; }
.catalog-map-canvas { width: 100%; height: 100%; background: #e6ecea; z-index: 0; font: inherit; }
.catalog-map-placeholder { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 14px; background: #eaf0f2; }
.catalog-map-placeholder p { margin: 0; }
.catalog-map-placeholder button { display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px solid #b1c1ce; }
.catalog-map-notice, .catalog-map-updating { position: absolute; z-index: 1; margin: 0; padding: 12px 16px; background: #fffffff2; box-shadow: 0 3px 18px #193c5617; font-size: 12px; line-height: 1.6; }
.catalog-map-notice { bottom: 36px; left: 58px; right: 16px; }
.catalog-map-notice p { margin: 0; }
.catalog-map-notice button { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; text-decoration: underline; text-underline-offset: 3px; }
.catalog-map-updating { top: 16px; right: 16px; }
.catalog-map-search { position: relative; z-index: 2; flex-shrink: 0; width: 100%; font-size: 12px; }
.catalog-map-search-controls { display: flex; align-items: stretch; background: #102d4c66; color: #c4d0e0; }
.catalog-map-search-controls input { flex: 1; min-width: 0; width: 100%; height: 43px; padding: 10px 12px; border: 1px solid transparent; border-radius: 0; background: transparent; color: #c4d0e0; font-size: 12px; }
.catalog-map-search-controls input::placeholder { color: #c4d0e0a6; }
.catalog-map-search .catalog-map-search-controls input:focus { background: #173a60 !important; border-color: #dce7f3 !important; color: #dce7f3 !important; }
.catalog-map-search-controls input::-webkit-search-cancel-button { appearance: none; }
.catalog-map-search-controls button { display: grid; place-items: center; flex-shrink: 0; width: 40px; padding: 0; border-radius: 0; }
.catalog-map-search-clear { background: transparent; color: #c4d0e0; }
.catalog-map-search-submit { background: #dce7f3; color: #173a60; }
.catalog-map-search-controls button:disabled { opacity: .55; cursor: default; }
.catalog-map-search-controls .catalog-map-search-submit:disabled { opacity: 1; }
.catalog-map-search-results { position: absolute; top: 100%; left: 0; right: 0; max-height: 240px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; margin: 0; padding: 0; list-style: none; border: 0; background: #102d4cf5; color: #c4d0e0; backdrop-filter: blur(12px); box-shadow: 0 6px 18px #193c561c; }
.catalog-map-search-results li + li { border-top: 1px solid #ffffff14; }
.catalog-map-search-results button { display: flex; align-items: flex-start; gap: 9px; width: 100%; padding: 13px; text-align: left; line-height: 1.5; }
.catalog-map-search-results button:hover { background: #173a60; }
.catalog-map-search-results svg { flex-shrink: 0; margin-top: 2px; }
.catalog-map-search-status { margin: 0; padding: 12px 14px; border: 0; background: #102d4cf5; color: #c4d0e0; line-height: 1.6; }
.catalog-map-sidebar { display: flex; flex-direction: column; min-height: 0; background: #102f50; }
.catalog-map-results { min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; padding: 0; }
.catalog-map-results::-webkit-scrollbar, .catalog-map-search-results::-webkit-scrollbar { display: none; }
.catalog-map-results :deep(.property-grid.catalog-map-panels) { grid-template-columns: minmax(0, 1fr); gap: 0; }
.catalog-map-item { border: 0; border-radius: 0; overflow: hidden; background: #102f50; }
.catalog-map-view .catalog-map-results .catalog-map-panels :deep(.property-card.catalog-panel) { min-height: 108px; transition: min-height .3s ease; }
.catalog-map-view .catalog-map-results .catalog-map-panels :deep(.property-card.catalog-panel.is-expanded) { min-height: 430px; }
.catalog-map-results .catalog-map-panels :deep(.card-body) { min-height: 108px; padding: 20px; }
.catalog-map-results .catalog-map-panels :deep(.property-card:not(.is-expanded) .empty-image) { padding: 0; }
.catalog-map-results .catalog-map-panels :deep(.card-body h3) { font-size: 22px; margin: 0 0 12px; transition: margin .3s ease; }
.catalog-map-results .catalog-map-panels :deep(.is-expanded .card-body h3) { margin: 12px 0 17px; }
.catalog-map-results .catalog-map-panels :deep(.card-price) { margin-top: 0; padding-top: 0; border-top-color: transparent; transition: margin .3s ease, padding .3s ease, border-color .3s ease; }
.catalog-map-results .catalog-map-panels :deep(.is-expanded .card-price) { margin-top: 20px; padding-top: 17px; border-top-color: #ffffff24; }
.catalog-map-results .catalog-map-panels :deep(.card-price strong) { font-size: 21px; }
.catalog-map-item.is-selected :deep(.card-body)::before { background: linear-gradient(120deg, #12385cb8, #245fbd66); }
.catalog-map-results .catalog-map-panels :deep(.property-card:not(.is-expanded) .card-body)::before {
  -webkit-mask-image: linear-gradient(to right, #000 56%, transparent calc(100% - 24px));
  mask-image: linear-gradient(to right, #000 56%, transparent calc(100% - 24px));
}
.catalog-map-unlocated { margin: 12px 0 0; color: #d0dded; font-size: 11px; }
.catalog-map-empty { padding: 20px; color: #d0dded; font-size: 13px; line-height: 1.6; }
.catalog-map-canvas :deep(.leaflet-control-attribution) { padding: 1px 4px; font-size: 9px; color: #425d70; }
.catalog-map-canvas :deep(.leaflet-control-attribution a) { color: #254e6c; }
.catalog-map-canvas :deep(.leaflet-bar) { border: 1px solid #cbd5dd; border-radius: 0; box-shadow: 0 3px 12px #193c561a; }
.catalog-map-canvas :deep(.leaflet-bar a:first-child), .catalog-map-canvas :deep(.leaflet-bar a:last-child) { border-radius: 0; }
.catalog-map-canvas :deep(.leaflet-bar a) { color: #193c56; }
.catalog-map-canvas :deep(.catalog-map-pin) { background: transparent; border: 0; }
.catalog-map-canvas :deep(.catalog-map-pin-body) { display: flex; align-items: center; justify-content: center; position: absolute; width: 34px; height: 34px; left: 1px; top: 5px; border: 2px solid #fff; border-radius: 50% 50% 50% 3px; background: #254e6c; color: #fff; box-shadow: 0 3px 10px #193c5640; transform: rotate(-45deg); transform-origin: 7px 27px; transition: background .2s, transform .2s; }
.catalog-map-canvas :deep(.catalog-map-pin-body svg) { width: 21px; height: 21px; transform: rotate(45deg); }
.catalog-map-canvas :deep(.catalog-map-pin.is-selected .catalog-map-pin-body) { background: #245fbd; transform: rotate(-45deg) scale(1.22); }
.catalog-map-canvas :deep(.catalog-map-cluster) { display: grid; place-items: center; border: 4px solid #fff; border-radius: 50%; color: #fff; background: #254e6c; box-shadow: 0 2px 10px #193c5633; font-size: 13px; font-weight: 600; }
.catalog-map-canvas :deep(.catalog-map-cluster.is-selected) { background: #245fbd; }
.catalog-map-canvas :deep(.catalog-map-search-pin) { display: grid; place-items: center; border: 3px solid #fff; border-radius: 50%; background: #245fbd; box-shadow: 0 0 0 5px #245fbd40, 0 3px 10px #193c5640; }
.catalog-map-canvas :deep(.catalog-map-search-pin span) { width: 7px; height: 7px; border-radius: 50%; background: #fff; }
.catalog-map-canvas :deep(.catalog-map-pin:focus-visible .catalog-map-pin-body), .catalog-map-canvas :deep(.catalog-map-cluster:focus-visible) { outline: 3px solid #245fbd; outline-offset: 4px; }
@media (max-width: 900px) { .catalog-map-view { grid-template-columns: minmax(0, 1fr) 285px; } }
@media (max-width: 700px) {
  .catalog-map-view { display: flex; flex-direction: column; height: auto; min-height: 0; }
  .catalog-map-area { height: 48vh; min-height: 300px; max-height: 460px; }
  .catalog-map-results { max-height: 440px; }
  .catalog-map-notice { font-size: 11px; }
}
@media (prefers-reduced-motion: reduce) {
  .catalog-map-canvas :deep(.catalog-map-pin-body), .catalog-map-view .catalog-map-results .catalog-map-panels :deep(.property-card.catalog-panel), .catalog-map-results .catalog-map-panels :deep(.card-body h3), .catalog-map-results .catalog-map-panels :deep(.card-price) { transition: none; }
}
</style>
