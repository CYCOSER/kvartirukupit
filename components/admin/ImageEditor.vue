<script setup lang="ts">
import { DialogRoot, DialogTrigger, DialogPortal, DialogOverlay, DialogContent, DialogTitle } from 'reka-ui';
import { Pencil, X, RotateCcw, Sparkles, Eye } from 'lucide-vue-next';
import Button from '~/components/ui/button/Button.vue';
import { rotateImageHue } from '~/shared/image-edit';
import type { Property } from '~/shared/property';

type Crop = { left: number; top: number; width: number; height: number };
type UpscaleStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'reverted' | null;
type Metadata = { file: string; originalFile: string; editFile: string; width: number; height: number; hueShift: number; crop: Crop | null; kind: 'photo' | 'plan'; upscale?: { status: UpscaleStatus; error: string | null; available: boolean } };
type ImageChanges = Pick<Metadata, 'file' | 'originalFile' | 'hueShift' | 'crop' | 'kind'>;
const props = defineProps<{ propertyId: string; image: Property['images'][number] }>();
const emit = defineEmits<{ updated: [image: ImageChanges] }>();
const open = ref(false);
const loading = ref(false);
const ready = ref(false);
const pending = ref(false);
const requestingUpscale = ref(false);
const upscaleError = ref('');
const error = ref('');
const conflict = ref(false);
const metadata = ref<Metadata>();
const previewMode = ref<'original' | 'edit'>('edit');
const hueShift = ref(0);
const crop = ref<Crop | null>(null);
const canvas = ref<HTMLCanvasElement>();
const stage = ref<HTMLDivElement>();
const previewHost = ref<HTMLDivElement>();
const previewBounds = ref({ width: 1, height: 1 });
let originalPixels: ImageData | undefined;
let loadVersion = 0;
let paintFrame = 0;
let observer: ResizeObserver | undefined;
let upscaleTimer: ReturnType<typeof setTimeout> | undefined;
let drag: { id: number; x: number; y: number; clientX: number; clientY: number; previous: Crop | null; moved: boolean } | undefined;
const endpoint = computed(() => `/api/admin/properties/${encodeURIComponent(props.propertyId)}/images/${encodeURIComponent(props.image.id)}`);
const fullCrop = computed<Crop>(() => ({ left: 0, top: 0, width: metadata.value?.width || 1, height: metadata.value?.height || 1 }));
const fields = computed(() => crop.value || fullCrop.value);
const dirty = computed(() => {
  if (!metadata.value) return false;
  const savedCrop = metadata.value.crop || fullCrop.value;
  return hueShift.value !== metadata.value.hueShift
    || (['left', 'top', 'width', 'height'] as const).some(key => fields.value[key] !== savedCrop[key]);
});
const upscalePending = computed(() => requestingUpscale.value || ['queued', 'processing'].includes(metadata.value?.upscale?.status || ''));
const enhanced = computed(() => metadata.value?.upscale?.status === 'completed');
const upscaleLabel = computed(() => {
  if (requestingUpscale.value) return 'Добавляем в очередь…';
  if (metadata.value?.upscale?.status === 'queued') return 'В очереди на улучшение…';
  if (metadata.value?.upscale?.status === 'processing') return 'Улучшаем качество…';
  if (enhanced.value) return previewMode.value === 'edit' ? 'Открыть оригинал' : 'Открыть улучшенное';
  return metadata.value?.upscale?.status === 'failed' ? 'Повторить улучшение' : 'Улучшить качество';
});
const validCrop = computed(() => {
  if (!metadata.value || !crop.value) return true;
  const c = crop.value;
  return Object.values(c).every(Number.isInteger) && c.left >= 0 && c.top >= 0 && c.width > 0 && c.height > 0
    && c.left + c.width <= metadata.value.width && c.top + c.height <= metadata.value.height;
});
const validHue = computed(() => Number.isInteger(hueShift.value) && hueShift.value >= -180 && hueShift.value <= 180);
const stageStyle = computed(() => {
  if (!metadata.value) return {};
  const scale = Math.min(previewBounds.value.width / metadata.value.width, previewBounds.value.height / metadata.value.height, 1);
  return { width: Math.max(1, Math.floor(metadata.value.width * scale)) + 'px', height: Math.max(1, Math.floor(metadata.value.height * scale)) + 'px' };
});
const cropStyle = computed(() => {
  if (!crop.value || !metadata.value) return {};
  return { left: `${crop.value.left / metadata.value.width * 100}%`, top: `${crop.value.top / metadata.value.height * 100}%`,
    width: `${crop.value.width / metadata.value.width * 100}%`, height: `${crop.value.height / metadata.value.height * 100}%` };
});
function message(cause: any, fallback: string) {
  return cause.data?.data?.message || cause.data?.message || fallback;
}
function changeOpen(value: boolean) {
  if (!value && pending.value) return;
  open.value = value;
}
function preventPendingDismiss(event: Event) {
  if (pending.value) event.preventDefault();
}
function paint() {
  if (!canvas.value || !originalPixels || !validHue.value) return;
  const pixels = new ImageData(new Uint8ClampedArray(originalPixels.data), originalPixels.width, originalPixels.height);
  rotateImageHue(pixels.data, 4, hueShift.value);
  canvas.value.getContext('2d')?.putImageData(pixels, 0, 0);
}
watch(hueShift, () => {
  previewMode.value = 'edit';
  cancelAnimationFrame(paintFrame);
  paintFrame = requestAnimationFrame(paint);
});
watch(crop, () => { previewMode.value = 'edit'; });
watch(previewHost, (element) => {
  observer?.disconnect();
  if (!element) return;
  observer = new ResizeObserver(([entry]) => {
    if (entry) previewBounds.value = { width: entry.contentRect.width, height: entry.contentRect.height };
  });
  observer.observe(element);
}, { flush: 'post' });
async function load() {
  clearTimeout(upscaleTimer);
  const version = ++loadVersion;
  loading.value = true;
  ready.value = false;
  error.value = '';
  conflict.value = false;
  upscaleError.value = '';
  metadata.value = undefined;
  originalPixels = undefined;
  try {
    const data = await $fetch<Metadata>(endpoint.value + '/editor');
    const url = new URL(data.editFile, window.location.origin);
    if (url.origin !== window.location.origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid image origin');
    const source = new Image();
    source.src = url.href;
    await source.decode();
    if (version !== loadVersion || !open.value) return;
    metadata.value = data;
    previewMode.value = 'edit';
    emit('updated', { file: data.file, originalFile: data.originalFile, kind: data.kind, crop: data.crop, hueShift: data.hueShift });
    hueShift.value = data.hueShift;
    crop.value = data.crop ? { ...data.crop } : null;
    await nextTick();
    if (!canvas.value) return;
    const scale = Math.min(1, 1200 / Math.max(data.width, data.height));
    canvas.value.width = Math.max(1, Math.round(data.width * scale));
    canvas.value.height = Math.max(1, Math.round(data.height * scale));
    const context = canvas.value.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas unavailable');
    context.drawImage(source, 0, 0, canvas.value.width, canvas.value.height);
    originalPixels = context.getImageData(0, 0, canvas.value.width, canvas.value.height);
    ready.value = true;
    paint();
  } catch (cause) {
    if (version === loadVersion) error.value = message(cause, 'Не удалось открыть исходное изображение. Повторите загрузку.');
  } finally {
    if (version === loadVersion) {
      loading.value = false;
      scheduleUpscalePoll();
    }
  }
}
function scheduleUpscalePoll() {
  clearTimeout(upscaleTimer);
  if (open.value && metadata.value?.upscale?.available) upscaleTimer = setTimeout(pollUpscale, 3000);
}
async function pollUpscale() {
  const version = loadVersion;
  try {
    const result = await $fetch<{ status: UpscaleStatus; error: string | null; file: string }>(endpoint.value + '/upscale');
    if (version !== loadVersion || !open.value || !metadata.value) return;
    metadata.value.upscale = { ...result, available: metadata.value.upscale?.available ?? true };
    upscaleError.value = '';
    if (result.file !== metadata.value.file && !pending.value) {
      if (!dirty.value) { await load(); return; }
      conflict.value = true;
      error.value = 'Фото изменилось во время редактирования. Ваши правки сохранены в окне; загрузите актуальную версию перед сохранением.';
    }
  } catch {
    if (version === loadVersion && open.value) upscaleError.value = 'Не удалось проверить обработку. Проверим ещё раз автоматически.';
  } finally {
    if (version === loadVersion) scheduleUpscalePoll();
  }
}
async function upscale() {
  if (enhanced.value) {
    if (!loading.value && !pending.value && !conflict.value) previewMode.value = previewMode.value === 'edit' ? 'original' : 'edit';
    return;
  }
  if (!metadata.value?.upscale?.available || dirty.value || pending.value || upscalePending.value || loading.value) return;
  const version = loadVersion;
  requestingUpscale.value = true;
  upscaleError.value = '';
  try {
    const result = await $fetch<{ status: UpscaleStatus }>(endpoint.value + '/upscale', {
      method: 'POST', body: { expectedFile: metadata.value.file },
    });
    if (version !== loadVersion || !metadata.value) return;
    metadata.value.upscale = { status: result.status, error: null, available: true };
    scheduleUpscalePoll();
  } catch (cause: any) {
    if (version !== loadVersion) return;
    conflict.value = cause.status === 409 || cause.statusCode === 409;
    if (conflict.value) error.value = message(cause, 'Фото изменилось. Загрузите актуальную версию и повторите улучшение.');
    else upscaleError.value = message(cause, 'Не удалось начать улучшение. Попробуйте ещё раз.');
  } finally { requestingUpscale.value = false; }
}
async function revertUpscale() {
  if (!metadata.value || dirty.value || pending.value || upscalePending.value) return;
  pending.value = true;
  error.value = '';
  try {
    await $fetch<ImageChanges>(endpoint.value + '/upscale-revert', {
      method: 'POST', body: { expectedFile: metadata.value.file },
    });
    await load();
  } catch (cause: any) {
    conflict.value = cause.status === 409 || cause.statusCode === 409;
    error.value = message(cause, 'Не удалось отменить улучшение. Повторите попытку.');
  } finally { pending.value = false; }
}
watch(open, (value) => {
  if (value) load();
  else { loadVersion++; clearTimeout(upscaleTimer); cancelAnimationFrame(paintFrame); originalPixels = undefined; drag = undefined; }
});
function setCropField(field: keyof Crop, event: Event) {
  crop.value = { ...fields.value, [field]: Number((event.target as HTMLInputElement).value) };
}
function point(event: PointerEvent) {
  const bounds = stage.value!.getBoundingClientRect();
  return {
    x: Math.min(metadata.value!.width, Math.max(0, Math.round((event.clientX - bounds.left) / bounds.width * metadata.value!.width))),
    y: Math.min(metadata.value!.height, Math.max(0, Math.round((event.clientY - bounds.top) / bounds.height * metadata.value!.height))),
  };
}
function beginCrop(event: PointerEvent) {
  if (!metadata.value || previewMode.value !== 'edit' || loading.value || pending.value || upscalePending.value || event.button !== 0) return;
  event.preventDefault();
  const start = point(event);
  drag = { id: event.pointerId, ...start, clientX: event.clientX, clientY: event.clientY, previous: crop.value ? { ...crop.value } : null, moved: false };
  stage.value!.setPointerCapture(event.pointerId);
}
function moveCrop(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId || !metadata.value) return;
  if (!drag.moved && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 3) return;
  drag.moved = true;
  const end = point(event);
  const left = Math.min(drag.x, end.x, metadata.value.width - 1);
  const top = Math.min(drag.y, end.y, metadata.value.height - 1);
  crop.value = { left, top, width: Math.max(1, Math.abs(end.x - drag.x)), height: Math.max(1, Math.abs(end.y - drag.y)) };
}
function endCrop(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId) return;
  if (event.type === 'pointercancel' || !drag.moved) crop.value = drag.previous;
  if (stage.value?.hasPointerCapture(event.pointerId)) stage.value.releasePointerCapture(event.pointerId);
  drag = undefined;
}
async function save() {
  if (!metadata.value || !originalPixels || !validCrop.value || !validHue.value || pending.value || upscalePending.value) return;
  pending.value = true;
  error.value = '';
  conflict.value = false;
  try {
    const c = crop.value;
    const normalizedCrop = c && (c.left || c.top || c.width !== metadata.value.width || c.height !== metadata.value.height) ? c : null;
    const updated = await $fetch<ImageChanges>(endpoint.value + '/edit', {
      method: 'POST', body: { expectedFile: metadata.value.file, crop: normalizedCrop, hueShift: hueShift.value },
    });
    emit('updated', { file: updated.file, originalFile: updated.originalFile, kind: updated.kind, crop: updated.crop, hueShift: updated.hueShift });
    pending.value = false;
    open.value = false;
  } catch (cause: any) {
    conflict.value = cause.status === 409 || cause.statusCode === 409;
    error.value = message(cause, 'Не удалось сохранить изображение. Изменения не применены; повторите попытку.');
  } finally { pending.value = false; }
}
onBeforeUnmount(() => { loadVersion++; clearTimeout(upscaleTimer); cancelAnimationFrame(paintFrame); observer?.disconnect(); });
</script>

<template>
  <DialogRoot :open="open" @update:open="changeOpen">
    <DialogTrigger as-child><button type="button" class="btn-secondary image-editor-trigger" :aria-label="'Редактировать фото: ' + image.alt"><Pencil :size="15" aria-hidden="true" />Редактировать фото</button></DialogTrigger>
    <DialogPortal>
      <DialogOverlay class="image-editor-overlay" />
      <DialogContent class="image-editor-dialog" :aria-describedby="undefined" @escape-key-down="preventPendingDismiss" @pointer-down-outside="preventPendingDismiss">
        <div class="image-editor-header"><DialogTitle class="image-editor-title">Редактировать фото</DialogTitle><button type="button" class="image-editor-close" aria-label="Закрыть редактор фото" :disabled="pending" @click="changeOpen(false)"><X :size="22" aria-hidden="true" /></button></div>
        <div class="image-editor-scroll">
          <p v-if="loading" class="image-editor-message" role="status">Загружаем исходное изображение…</p>
          <div v-if="metadata" class="image-editor-body">
            <div>
              <div ref="previewHost" class="image-editor-preview">
                <img v-if="previewMode === 'original'" :src="metadata.originalFile" :alt="image.alt" class="image-editor-result" data-testid="image-editor-original" />
                <div v-show="previewMode === 'edit'" ref="stage" class="image-crop-stage" :style="stageStyle" data-testid="image-crop-stage" @pointerdown="beginCrop" @pointermove="moveCrop" @pointerup="endCrop" @pointercancel="endCrop">
                  <canvas ref="canvas" role="img" aria-label="Предпросмотр изображения. Для точной обрезки используйте поля обрезки." />
                  <div v-if="crop && validCrop" class="image-crop-selection" :style="cropStyle" aria-hidden="true"><i v-for="corner in 4" :key="corner" /></div>
                </div>
              </div>
              <p class="image-editor-size">{{ enhanced ? 'Улучшенное фото' : 'Оригинал' }}: {{ metadata.width }} × {{ metadata.height }} px <span>Обрезка: {{ fields.width }} × {{ fields.height }} px</span></p>
              <div class="image-upscale-control">
                <div class="image-upscale-actions">
                  <button type="button" class="btn-secondary image-upscale-button" :disabled="loading || pending || !ready || conflict || upscalePending || (!enhanced && (dirty || !metadata.upscale?.available))" @click="upscale"><component :is="enhanced ? Eye : Sparkles" :size="16" aria-hidden="true" />{{ upscaleLabel }}</button>
                  <button v-if="metadata.upscale?.status === 'completed'" type="button" class="btn-secondary image-upscale-button" :disabled="loading || pending || dirty || conflict" @click="revertUpscale"><RotateCcw :size="15" aria-hidden="true" />Отменить улучшение</button>
                </div>
                <p v-if="!metadata.upscale?.available || dirty || upscalePending || metadata.upscale?.status === 'reverted'" class="image-editor-description" role="status">{{ !metadata.upscale?.available ? 'Улучшение временно недоступно.' : dirty ? 'Сначала сохраните обрезку и цвет.' : upscalePending ? 'Редактор можно закрыть — обработка продолжится.' : 'Улучшение отменено. Повторный запуск — только вручную.' }}</p>
                <p v-if="upscaleError || metadata.upscale?.error" class="image-editor-error" role="alert">{{ upscaleError || metadata.upscale?.error }}</p>
              </div>
            </div>
            <fieldset class="image-editor-controls" :disabled="loading || pending || upscalePending || !ready">
              <legend class="sr-only">Настройки изображения</legend>
              <div class="image-editor-control-heading"><h3>Обрезка</h3><button type="button" class="image-editor-reset" @click="crop = null"><RotateCcw :size="13" aria-hidden="true" />Сбросить обрезку</button></div>
              <p class="image-editor-description">Выделите область на фото.</p>
              <div class="image-crop-fields">
                <label>Слева, px<input type="number" :value="fields.left" min="0" :max="metadata.width - 1" step="1" @input="setCropField('left', $event)" /></label>
                <label>Сверху, px<input type="number" :value="fields.top" min="0" :max="metadata.height - 1" step="1" @input="setCropField('top', $event)" /></label>
                <label>Ширина, px<input type="number" :value="fields.width" min="1" :max="metadata.width" step="1" @input="setCropField('width', $event)" /></label>
                <label>Высота, px<input type="number" :value="fields.height" min="1" :max="metadata.height" step="1" @input="setCropField('height', $event)" /></label>
              </div>
              <p v-if="!validCrop" class="image-editor-error" role="alert">Область должна целиком находиться внутри оригинала. Координаты и размеры — целые пиксели.</p>
              <div class="image-editor-control-heading image-editor-color-heading"><h3>Цветовой тон (RGB)</h3><button type="button" class="image-editor-reset" @click="hueShift = 0"><RotateCcw :size="13" aria-hidden="true" />Сбросить цвет</button></div>
              <input v-model.number="hueShift" class="image-hue-slider" type="range" min="-180" max="180" step="1" aria-label="Цветовой тон (RGB)" />
              <label class="image-hue-value">Сдвиг, °<input v-model.number="hueShift" type="number" min="-180" max="180" step="1" aria-label="Сдвиг цветового тона, градусы" /></label>
              <p v-if="!validHue" class="image-editor-error" role="alert">Укажите целое число от −180° до 180°.</p>
            </fieldset>
          </div>
          <div v-if="error" class="image-editor-message"><p class="image-editor-error" role="alert">{{ error }}</p><button v-if="!ready || conflict" type="button" class="btn-secondary" :disabled="loading || pending" @click="load">{{ conflict ? 'Загрузить актуальную версию' : 'Повторить загрузку' }}</button></div>
        </div>
        <div class="image-editor-footer"><span v-if="pending" role="status">Сохраняем изображение…</span><button type="button" class="btn-secondary" :disabled="pending" @click="changeOpen(false)">Отмена</button><Button type="button" :disabled="loading || pending || upscalePending || !ready || !metadata || !validCrop || !validHue" @click="save">{{ pending ? 'Сохраняем…' : 'Сохранить изменения' }}</Button></div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.image-editor-trigger { display: inline-flex; gap: 8px; margin: 12px 0; font-size: 13px; }
.image-editor-overlay { position: fixed; inset: 0; z-index: 100; background: #10243eb3; backdrop-filter: blur(3px); }
.image-editor-dialog { position: fixed; top: 50%; left: 50%; z-index: 101; display: flex; flex-direction: column; width: min(1080px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); transform: translate(-50%, -50%); border: 1px solid #dce5f2; border-radius: 18px; background: white; color: #273d5e; box-shadow: 0 30px 100px #10243e40; }
.image-editor-header { display: flex; align-items: start; justify-content: space-between; gap: 24px; padding: 24px; border-bottom: 1px solid #e3e9f2; }
.image-editor-title { margin: 0 0 8px; font-size: 23px; font-weight: 700; }
.image-editor-description { color: #63738d; font-size: 12px; line-height: 1.6; }
.image-editor-close { display: grid; flex: 0 0 36px; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: #f0f4fa; }
.image-editor-scroll { overflow-y: auto; overscroll-behavior: contain; }
.image-editor-body { display: grid; grid-template-columns: minmax(0, 1fr) 290px; gap: 24px; padding: 24px; }
.image-editor-preview { display: flex; align-items: center; justify-content: center; height: min(54vh, 540px); min-height: 220px; padding: 12px; overflow: hidden; border: 1px solid #dce5f2; border-radius: 12px; background: #eff3f9; }
.image-editor-result { display: block; width: 100%; height: 100%; object-fit: contain; }
.image-crop-stage { position: relative; flex: none; overflow: hidden; cursor: crosshair; touch-action: none; user-select: none; }
.image-crop-stage canvas { display: block; width: 100%; height: 100%; }
.image-crop-selection { position: absolute; border: 1px solid white; outline: 1px solid #245fbd; box-shadow: 0 0 0 3000px #10243e80; pointer-events: none; }
.image-crop-selection i { position: absolute; width: 7px; height: 7px; border: 1px solid white; background: #245fbd; }
.image-crop-selection i:nth-child(1) { left: -3px; top: -3px; }.image-crop-selection i:nth-child(2) { right: -3px; top: -3px; }.image-crop-selection i:nth-child(3) { left: -3px; bottom: -3px; }.image-crop-selection i:nth-child(4) { right: -3px; bottom: -3px; }
.image-editor-size { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; margin: 14px 0 8px; color: #345d96; font-size: 12px; }
.image-upscale-control { display: grid; gap: 8px; margin-top: 18px; padding-top: 16px; border-top: 1px solid #e3e9f2; }
.image-upscale-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.image-upscale-button { display: inline-flex; justify-self: start; align-items: center; gap: 8px; font-size: 13px; }
.image-editor-controls { min-width: 0; border: 0; }
.image-editor-control-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.image-editor-control-heading h3 { font-size: 15px; font-weight: 700; }
.image-editor-reset { display: inline-flex; align-items: center; gap: 5px; color: #345d96; font-size: 11px; }
.image-crop-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px; }
.image-editor-controls label { display: grid; gap: 6px; color: #63738d; font-size: 12px; }
.image-editor-controls input[type='number'] { min-width: 0; width: 100%; padding: 10px 12px; border: 1px solid #dce5f2; border-radius: 8px; background: white; color: #273d5e; font-size: 14px; }
.image-editor-color-heading { margin-top: 28px; }
.image-hue-slider { width: 100%; height: 20px; padding: 0; border: 0; margin: 10px 0 16px; background: transparent; accent-color: #245fbd; cursor: pointer; }
.image-editor-controls .image-hue-value { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }.image-hue-value input { max-width: 100px; }
.image-editor-error { margin-top: 10px; color: #b3433a; font-size: 12px; line-height: 1.6; }
.image-editor-message { padding: 16px 24px; }.image-editor-message .btn-secondary { margin-top: 12px; }
.image-editor-footer { display: flex; align-items: center; justify-content: end; gap: 12px; padding: 18px 24px; border-top: 1px solid #e3e9f2; }.image-editor-footer span { margin-right: auto; color: #63738d; font-size: 12px; }
.image-editor-dialog :where(button,input):focus-visible { outline: 2px solid #245fbd; outline-offset: 3px; }.image-editor-dialog button:disabled { opacity: .55; cursor: not-allowed; }
@media (max-width: 760px) { .image-editor-dialog { width: calc(100vw - 20px); max-height: calc(100dvh - 20px); border-radius: 14px; }.image-editor-header,.image-editor-body { padding: 18px; }.image-editor-body { grid-template-columns: 1fr; gap: 20px; }.image-editor-preview { height: min(42vh,360px); min-height: 180px; }.image-editor-title { font-size: 20px; }.image-editor-footer { flex-wrap: wrap; padding: 14px 18px; }.image-editor-footer span { width: 100%; }.image-editor-footer > button { flex: 1; } }
</style>
