<script setup lang="ts">
import { MapPin, Search } from 'lucide-vue-next';
import type * as Leaflet from 'leaflet';
import type { MapSearchResult } from '~/shared/map-search';
import { propertyAddress } from '~/shared/property';
import 'leaflet/dist/leaflet.css';

const props = defineProps<{ address: string; location: string; latitude: number | null; longitude: number | null }>();
const emit = defineEmits<{ 'update:latitude': [value: number | null]; 'update:longitude': [value: number | null] }>();
const canvas = ref<HTMLElement>();
const pending = ref(false);
const ready = ref(false);
const error = ref('');
const tileError = ref(false);
const results = ref<MapSearchResult[]>([]);
const selected = computed(() => props.latitude !== null && props.longitude !== null);
let L: typeof Leaflet;
let map: Leaflet.Map | undefined;
let marker: Leaflet.Marker | undefined;
let tiles: Leaflet.TileLayer | undefined;
let observer: ResizeObserver | undefined;
let controller: AbortController | undefined;
let version = 0;
let disposed = false;

function resetSearch() {
  controller?.abort(); version++; pending.value = false; results.value = []; error.value = '';
}
watch(() => [props.address, props.location], () => {
  resetSearch();
  // Coordinates belong to the selected address, never to a later edit.
  emit('update:latitude', null); emit('update:longitude', null);
}, { flush: 'sync' });
function setPoint(latitude: number, longitude: number) {
  resetSearch();
  longitude = L.latLng(latitude, longitude).wrap().lng;
  emit('update:latitude', Number(latitude.toFixed(6)));
  emit('update:longitude', Number(longitude.toFixed(6)));
}
function renderPoint() {
  if (!map || !L) return;
  marker?.remove(); marker = undefined;
  if (!selected.value) return;
  marker = L.marker([props.latitude!, props.longitude!], {
    draggable: true, title: 'Местоположение объекта', alt: 'Местоположение объекта',
    icon: L.divIcon({ className: 'property-address-pin', html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 13] }),
  }).addTo(map).on('dragend', event => {
    const point = event.target.getLatLng(); setPoint(point.lat, point.lng);
  });
}
watch(() => [props.latitude, props.longitude], renderPoint);
async function search() {
  resetSearch();
  const query = propertyAddress(props);
  if (query.length < 2 || query.length > 200) { error.value = 'Укажите город, улицу и дом — до 200 символов.'; return; }
  const request = version;
  controller = new AbortController(); pending.value = true;
  try {
    const response = await $fetch<{ items: MapSearchResult[] }>('/api/map/search', { query: { q: query }, signal: controller.signal });
    if (disposed || request !== version) return;
    results.value = response.items;
    if (!response.items.length) error.value = 'Адрес не найден. Уточните его или поставьте метку на карте.';
  } catch {
    if (!disposed && request === version) error.value = 'Поиск адреса недоступен. Повторите попытку или поставьте метку на карте.';
  } finally { if (request === version) pending.value = false; }
}
function choose(result: MapSearchResult) {
  setPoint(result.latitude, result.longitude); map?.setView([result.latitude, result.longitude], 17);
}
function markCenter() {
  if (map) { const point = map.getCenter(); setPoint(point.lat, point.lng); }
}
async function initialize() {
  error.value = '';
  try {
    L = await import('leaflet');
    if (disposed || !canvas.value) return;
    map = L.map(canvas.value, { scrollWheelZoom: false }).setView(
      selected.value ? [props.latitude!, props.longitude!] : [54.7104, 20.4522], selected.value ? 16 : 10);
    map.attributionControl.setPrefix(false);
    tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
    }).on('tileerror', () => { tileError.value = true; }).on('tileload', () => { tileError.value = false; }).addTo(map);
    map.on('click', event => setPoint(event.latlng.lat, event.latlng.lng));
    renderPoint(); observer = new ResizeObserver(() => map?.invalidateSize({ animate: false })); observer.observe(canvas.value);
    ready.value = true;
  } catch { error.value = 'Не удалось загрузить карту.'; map?.remove(); map = undefined; }
}
onMounted(initialize);
onBeforeUnmount(() => { disposed = true; resetSearch(); observer?.disconnect(); map?.remove(); });
</script>

<template>
  <section class="address-map" data-testid="property-address-map" aria-label="Местоположение объекта">
    <div class="address-map-toolbar"><strong><MapPin :size="16" aria-hidden="true" />На карте</strong><button type="button" class="btn-secondary" :disabled="pending || !ready" @click="search"><Search :size="15" aria-hidden="true" />{{ pending ? 'Ищем…' : 'Найти адрес на карте' }}</button></div>
    <ul v-if="results.length" class="address-results" aria-label="Найденные адреса"><li v-for="result in results" :key="result.id"><button type="button" @click="choose(result)"><MapPin :size="15" aria-hidden="true" />{{ result.label }}</button></li></ul>
    <p v-if="error" class="error-text" role="alert">{{ error }} <button v-if="!ready" type="button" class="underline" @click="initialize">Повторить</button></p>
    <div ref="canvas" class="address-map-canvas" data-testid="property-address-map-canvas" role="region" aria-label="Карта адреса объекта" />
    <div class="address-map-footer"><span role="status">{{ selected ? 'Можно уточнить положение, перетащив метку.' : 'Выберите найденный адрес или точку на карте.' }}</span><button v-if="ready" type="button" class="address-map-center" @click="markCenter">Метка в центре карты</button></div>
    <p v-if="tileError" class="error-text" role="status">Карта не загрузилась. <button type="button" class="underline" @click="tiles?.redraw()">Повторить</button></p>
  </section>
</template>

<style scoped>
.address-map { min-width: 0; padding: 16px; border: 1px solid #dce4f0; border-radius: 12px; background: #fafcfe; }
.address-map-toolbar,.address-map-toolbar strong { display: flex; align-items: center; gap: 8px; }.address-map-toolbar { justify-content: space-between; gap: 16px; margin-bottom: 12px; }.address-map-toolbar strong { color: #345475; font-size: 13px; }
.address-map-canvas { position: relative; height: 260px; border-radius: 8px; overflow: hidden; z-index: 0; background: #e9eef3; }
.address-map-footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-top: 10px; font-size: 11px; color: #66768f; }.address-map-center { color: #345d96; text-decoration: underline; text-underline-offset: 3px; }
.address-results { display: grid; gap: 4px; margin-bottom: 12px; }.address-results button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px; border-radius: 7px; text-align: left; color: #345475; font-size: 12px; }.address-results button:hover { background: #e8f0fb; }.address-results svg { flex-shrink: 0; }
:deep(.property-address-pin) { display: grid; place-items: center; border: 2px solid #fff; border-radius: 50%; background: #245fbd; box-shadow: 0 2px 8px #102f5066; }:deep(.property-address-pin span) { width: 8px; height: 8px; border-radius: 50%; background: #fff; }
@media(max-width: 540px) { .address-map { padding: 12px; }.address-map-toolbar { flex-wrap: wrap; gap: 8px; }.address-map-canvas { height: 220px; } }
</style>
