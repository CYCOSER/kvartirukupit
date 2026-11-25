<script setup lang="ts">
import { useAnalyticsConsent } from '~/composables/useAnalyticsConsent';
import { Shield } from 'lucide-vue-next';

const { needsConsent, policyVersion, serverVersion, acceptConsent, rejectConsent } = useAnalyticsConsent();
const loading = ref(false);

const currentVersion = computed(() => serverVersion.value?.version || policyVersion.value);
const effectiveDate = computed(() => serverVersion.value?.effectiveAt ? new Date(serverVersion.value.effectiveAt).toLocaleDateString('ru-RU') : '');

async function handleAccept() {
  if (!currentVersion.value) return;
  loading.value = true;
  try {
    acceptConsent(currentVersion.value);
  } finally {
    loading.value = false;
  }
}

async function handleReject() {
  if (!currentVersion.value) return;
  loading.value = true;
  try {
    rejectConsent(currentVersion.value);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div v-if="needsConsent" class="privacy-consent-overlay">
    <div class="privacy-consent-modal">
      <div class="privacy-consent-icon">
        <Shield :size="32" />
      </div>
      <h2 class="privacy-consent-title">Обновление политики конфиденциальности</h2>
      <p class="privacy-consent-subtitle">
        {{ effectiveDate ? `Согласие от ${effectiveDate}` : 'Текст политики был обновлён' }}.
        Пожалуйста, ознакомитесь и подтвердите согласие.
      </p>
      <div class="privacy-consent-actions">
        <button class="privacy-consent-btn secondary" @click="handleReject" :disabled="loading">
          Технические cookie
        </button>
        <button class="privacy-consent-btn primary" @click="handleAccept" :disabled="loading">
          Принять все
        </button>
      </div>
      <p class="privacy-consent-link">
        <NuxtLink :to="`/privacy`" target="_blank">Прочитать политику</NuxtLink>
      </p>
    </div>
  </div>
</template>

<style scoped>
.privacy-consent-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(10, 25, 45, 0.85);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.privacy-consent-modal {
  position: relative;
  background: white;
  border-radius: 16px;
  padding: 40px 32px;
  max-width: 440px;
  width: 100%;
  text-align: center;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.4);
}
.privacy-consent-icon {
  width: 72px;
  height: 72px;
  margin: 0 auto 20px;
  border-radius: 50%;
  background: #e0e7ff;
  color: #4f46e5;
  display: flex;
  align-items: center;
  justify-content: center;
}
.privacy-consent-title {
  font-size: 22px;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 12px;
}
.privacy-consent-subtitle {
  font-size: 15px;
  line-height: 1.6;
  color: #475569;
  margin: 0 0 28px;
}
.privacy-consent-actions {
  display: flex;
  gap: 12px;
}
.privacy-consent-btn {
  flex: 1;
  padding: 14px 20px;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid transparent;
}
.privacy-consent-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.privacy-consent-btn.secondary {
  background: #f1f5f9;
  color: #475569;
  border-color: #e2e8f0;
}
.privacy-consent-btn.secondary:hover:not(:disabled) {
  background: #e2e8f0;
}
.privacy-consent-btn.primary {
  background: #4f46e5;
  color: white;
}
.privacy-consent-btn.primary:hover:not(:disabled) {
  background: #4338ca;
}
.privacy-consent-link {
  margin-top: 20px;
  font-size: 13px;
}
.privacy-consent-link a {
  color: #4f46e5;
  text-decoration: underline;
}
</style>