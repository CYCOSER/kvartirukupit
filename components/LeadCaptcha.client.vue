<script lang="ts">
type SmartCaptcha = {
  render: (container: HTMLElement, options: { sitekey: string; hl: 'ru'; callback: (token: string) => void }) => number;
  subscribe: (id: number, event: 'token-expired' | 'network-error' | 'javascript-error', callback: () => void) => () => void;
  reset: (id: number) => void;
  destroy: (id: number) => void;
};
type CaptchaWindow = Window & {
  smartCaptcha?: SmartCaptcha;
  onLeadCaptchaLoad?: () => void;
};
let scriptPromise: Promise<SmartCaptcha> | undefined;

function loadCaptcha() {
  const host = window as CaptchaWindow;
  if (host.smartCaptcha) return Promise.resolve(host.smartCaptcha);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<SmartCaptcha>((resolve, reject) => {
    const script = document.createElement('script');
    const finish = (error?: Error) => {
      clearTimeout(timer);
      delete host.onLeadCaptchaLoad;
      script.onerror = null;
      if (error || !host.smartCaptcha) {
        script.remove();
        reject(error || new Error('SmartCaptcha unavailable'));
        return;
      }
      resolve(host.smartCaptcha);
    };
    const timer = setTimeout(() => finish(new Error('SmartCaptcha timeout')), 15000);
    host.onLeadCaptchaLoad = () => finish();
    script.src = 'https://smartcaptcha.cloud.yandex.ru/captcha.js?render=onload&onload=onLeadCaptchaLoad';
    script.async = true;
    script.onerror = () => finish(new Error('SmartCaptcha load failed'));
    document.head.append(script);
  }).catch(error => {
    scriptPromise = undefined;
    throw error;
  });
  return scriptPromise;
}
</script>

<script setup lang="ts">
import Button from '~/components/ui/button/Button.vue';
import { useAnalyticsConsent } from '~/composables/useAnalyticsConsent';

const props = defineProps<{ siteKey: string }>();
const token = defineModel<string>({ required: true });
const { consent, openSettings } = useAnalyticsConsent();
const frame = ref<HTMLElement>();
const container = ref<HTMLElement>();
const scale = ref(1);
const loading = ref(false);
const error = ref('');
let api: SmartCaptcha | undefined;
let widgetId: number | undefined;
let disposed = false;
let observer: ResizeObserver | undefined;

function failed() {
  token.value = '';
  error.value = 'Не удалось загрузить проверку. Проверьте подключение и повторите попытку.';
}

async function initialize() {
  if (loading.value) return;
  loading.value = true;
  error.value = '';
  token.value = '';
  try {
    api = await loadCaptcha();
    if (disposed || !container.value) return;
    if (widgetId !== undefined) api.destroy(widgetId);
    widgetId = api.render(container.value, {
      sitekey: props.siteKey,
      hl: 'ru',
      callback: value => {
        token.value = value;
        error.value = '';
      },
    });
    api.subscribe(widgetId, 'token-expired', () => {
      reset();
      error.value = 'Срок проверки истёк. Пройдите её ещё раз.';
    });
    api.subscribe(widgetId, 'network-error', failed);
    api.subscribe(widgetId, 'javascript-error', failed);
  } catch {
    if (!disposed) failed();
  } finally {
    loading.value = false;
  }
}

function reset() {
  token.value = '';
  error.value = '';
  try {
    if (widgetId !== undefined) api?.reset(widgetId);
  } catch {
    failed();
  }
}

watch([frame, consent], ([element, value]) => {
  observer?.disconnect();
  if (value !== 'accepted' || !element) {
    if (widgetId !== undefined) {
      api?.destroy(widgetId);
      widgetId = undefined;
      token.value = '';
    }
    return;
  }
  // SmartCaptcha's checkbox requires a minimum width of 300px.
  observer = new ResizeObserver(([entry]) => {
    if (entry) scale.value = Math.min(1, entry.contentRect.width / 300);
  });
  observer.observe(element);
  initialize();
}, { flush: 'post', immediate: true });
onBeforeUnmount(() => {
  disposed = true;
  observer?.disconnect();
  if (widgetId !== undefined) api?.destroy(widgetId);
});
defineExpose({ reset });
</script>

<template>
  <div class="lead-captcha">
    <div ref="frame" class="captcha-frame">
      <p v-if="consent !== 'accepted'" class="captcha-consent">
        Для защиты формы нужен сервис Яндекса.
        <button type="button" @click="openSettings">Настроить cookie</button>
      </p>
      <p v-else-if="loading" role="status" class="captcha-loading">Загружаем проверку…</p>
      <div ref="container" class="captcha-widget" :style="{ transform: `scale(${scale})` }" />
    </div>
    <p v-if="error" role="alert" class="captcha-error">{{ error }}</p>
    <Button v-if="error" type="button" :disabled="loading" @click="initialize">
      Повторить проверку
    </Button>
  </div>
</template>

<style scoped>
.lead-captcha {
  min-width: 0;
  font-size: 0.875rem;
}
.captcha-widget {
  width: 300px;
  min-height: 118px;
  transform-origin: top left;
}
.captcha-frame {
  position: relative;
  width: 100%;
  max-width: 300px;
  overflow: hidden;
}
.captcha-loading {
  position: absolute;
  margin: 0;
}
.captcha-consent {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.5;
}
.captcha-consent button {
  color: #245fbd;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.captcha-error {
  margin-bottom: 12px;
  color: #b4232b;
}
</style>
