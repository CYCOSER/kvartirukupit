<script setup lang="ts">
import { onMounted, watch } from "vue";
import {
  useAnalyticsConsent,
  type AnalyticsConsent,
} from "~/composables/useAnalyticsConsent";

type YandexMetrika = ((...args: unknown[]) => void) & {
  a?: unknown[][];
  l?: number;
};
type YandexWindow = Window & { ym?: YandexMetrika };

const {
  consent,
  settingsOpen,
  needsConsent,
  setConsent,
} = useAnalyticsConsent();
let metrikaLoaded = false;

function loadMetrika() {
  if (metrikaLoaded) return;
  metrikaLoaded = true;

  const host = window as YandexWindow;
  const ym: YandexMetrika =
    host.ym ||
    Object.assign(
      (...args: unknown[]) => {
        (ym.a ||= []).push(args);
      },
      { l: Date.now() },
    );
  host.ym = ym;
  ym(114233228, "init", {
    ssr: true,
    webvisor: true,
    clickmap: true,
    ecommerce: "dataLayer",
    referrer: document.referrer,
    url: location.href,
    accurateTrackBounce: true,
    trackLinks: true,
  });

  const script = document.createElement("script");
  script.src = "https://mc.yandex.ru/metrika/tag.js?id=114233228";
  script.async = true;
  script.onerror = () => {
    metrikaLoaded = false;
    script.remove();
    console.error("Не удалось загрузить Яндекс.Метрику.");
  };
  document.head.append(script);
}

function choose(value: Exclude<AnalyticsConsent, "unknown">) {
  setConsent(value);
}

onMounted(() => {
  // Consent state is initialized by the privacy-consent plugin before mount.
  if (consent.value === "accepted") loadMetrika();
});

watch(consent, (value) => {
  if (value === "accepted") loadMetrika();
});

// Watch for needsConsent changes to hide cookie banner when privacy dialog shows
watch(needsConsent, (val) => {
  if (val) {
    // Hide the cookie banner when the privacy consent dialog is shown
    settingsOpen.value = false;
  }
});
</script>

<template>
  <aside
    v-if="settingsOpen && !needsConsent"
    class="cookie-consent"
    aria-label="Настройки cookie и аналитики"
  >
    <div class="cookie-consent-copy">
      <strong>Cookie и сервисы Яндекса</strong>
      <p>
        Мы используем cookie и сервисы Яндекса: Метрику для аналитики и
        SmartCaptcha для защиты форм. Они будут включены только после вашего
        согласия. Подробнее — в
        <NuxtLink to="/privacy">Политике конфиденциальности</NuxtLink>.
      </p>
    </div>
    <div class="cookie-consent-actions">
      <button class="cookie-consent-accept" type="button" @click="choose('accepted')">
        Согласен(-на)
      </button>
      <button class="cookie-consent-essential" type="button" @click="choose('necessary')">
        Только необходимые
      </button>
    </div>
  </aside>
</template>

<style scoped>
.cookie-consent {
  position: fixed;
  z-index: 120;
  right: 24px;
  bottom: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  width: min(760px, calc(100vw - 32px));
  padding: 20px 24px;
  border: 1px solid #c5d2e2;
  background: #f7f9fc;
  color: #18355a;
  box-shadow: 0 12px 40px #102f5033;
}
.cookie-consent-copy {
  max-width: 470px;
}
.cookie-consent-copy strong {
  font-family: var(--font-brand);
  font-size: 1.05rem;
}
.cookie-consent-copy p {
  margin: 6px 0 0;
  font-size: 0.8rem;
  line-height: 1.6;
}
.cookie-consent-copy a {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.cookie-consent-actions {
  display: grid;
  flex-shrink: 0;
  gap: 8px;
}
.cookie-consent-actions button {
  min-height: 42px;
  padding: 10px 14px;
  border: 1px solid #18355a;
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.cookie-consent-accept {
  background: #18355a;
  color: #fff;
}
.cookie-consent-essential {
  background: transparent;
  color: #18355a;
}
.cookie-consent-actions button:focus-visible {
  outline: 2px solid #245fbd;
  outline-offset: 3px;
}
@media (max-width: 640px) {
  .cookie-consent {
    right: 8px;
    bottom: 8px;
    flex-direction: column;
    align-items: stretch;
    gap: 14px;
    width: calc(100vw - 16px);
    padding: 16px;
  }
  .cookie-consent-actions {
    grid-template-columns: 1fr 1fr;
  }
  .cookie-consent-actions button {
    padding-inline: 8px;
  }
}
</style>