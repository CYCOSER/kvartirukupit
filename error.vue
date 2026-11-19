<script setup lang="ts">
import { ArrowRight, RefreshCw } from "lucide-vue-next";

const props = defineProps<{
  error: {
    statusCode?: number;
  };
}>();

const details = computed(() => {
  switch (props.error.statusCode) {
    case 403:
      return {
        code: "403",
        eyebrow: "ДОСТУП ОГРАНИЧЕН",
        title: "Доступ запрещён",
        description:
          "У вас нет прав для просмотра этой страницы. Вы можете вернуться на главную или продолжить поиск квартиры.",
      };
    case 404:
      return {
        code: "404",
        eyebrow: "СТРАНИЦА НЕ НАЙДЕНА",
        title: "Страница не найдена",
        description: "Возможно, ссылка устарела или страница была удалена.",
      };
    default:
      return {
        code: "500",
        eyebrow: "ЧТО-ТО ПОШЛО НЕ ТАК",
        title: "Внутренняя ошибка сервера",
        description:
          "Не удалось загрузить страницу. Попробуйте ещё раз или вернитесь позже.",
      };
  }
});

function goHome() {
  clearError({ redirect: "/" });
}

function retry() {
  window.location.reload();
}
</script>

<template>
  <main class="error-page">
    <header class="error-header">
      <NuxtLink to="/" class="error-brand" aria-label="На главную">
        <BrandMark class="error-brand-mark" />
        <BrandName />
      </NuxtLink>
      <NuxtLink to="/catalog" class="error-catalog-link">
        Каталог квартир <ArrowRight :size="16" aria-hidden="true" />
      </NuxtLink>
    </header>

    <section class="error-content" aria-labelledby="error-title">
      <!--<div class="error-number" aria-hidden="true">{{ details.code }}</div>-->
      <p class="eyebrow error-eyebrow">{{ details.eyebrow }}</p>
      <h1 id="error-title">{{ details.code }}. {{ details.title }}</h1>
      <p class="error-description">{{ details.description }}</p>
      <div class="error-actions">
        <button
          v-if="details.code === '500'"
          class="error-primary"
          type="button"
          @click="retry"
        >
          <RefreshCw :size="17" aria-hidden="true" />
          Попробовать снова
        </button>
        <button v-else class="error-primary" type="button" @click="goHome">
          На главную <ArrowRight :size="17" aria-hidden="true" />
        </button>
        <NuxtLink to="/catalog" class="error-secondary">
          Перейти в каталог
        </NuxtLink>
      </div>
    </section>

    <footer class="error-footer">
      <span>Квартирукупить</span>
      <span>Недвижимость в Калининграде</span>
    </footer>
  </main>
</template>

<style scoped>
.error-page {
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  overflow: hidden;
  padding: 28px clamp(20px, 6vw, 88px) 24px;
  background:
    radial-gradient(ellipse at 82% 55%, #d2dfef 0, transparent 44%),
    linear-gradient(135deg, #f3f6fa, #e6edf6);
  color: #102f50;
}
.error-header,
.error-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.error-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: -0.045em;
}
.error-brand-mark {
  width: 36px;
  height: 36px;
  color: #245fbd;
}
.error-catalog-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
}
.error-content {
  position: relative;
  z-index: 1;
  width: min(660px, 100%);
  margin: auto;
  padding-block: 80px;
}
.error-number {
  position: absolute;
  z-index: -1;
  top: 50%;
  left: -0.08em;
  color: #d3dfed;
  font-family: var(--font-brand);
  font-size: clamp(11rem, 34vw, 25rem);
  font-weight: 400;
  letter-spacing: -0.1em;
  line-height: 0.8;
  transform: translateY(-57%);
  user-select: none;
}
.error-eyebrow {
  margin-bottom: 20px;
  color: #245fbd;
}
.error-content h1 {
  max-width: 600px;
  font-family: var(--font-brand);
  font-size: clamp(2.5rem, 6vw, 5rem);
  font-weight: 400;
  letter-spacing: -0.045em;
  line-height: 1.08;
}
.error-description {
  max-width: 460px;
  margin-top: 20px;
  color: #536b88;
  font-size: 1rem;
  line-height: 1.8;
}
.error-actions {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-top: 32px;
}
.error-primary {
  display: inline-flex;
  min-height: 48px;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 12px 18px;
  border: 1px solid #102f50;
  background: #102f50;
  color: #fff;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 600;
}
.error-primary:hover {
  background: #1e4771;
}
.error-secondary {
  color: #304c6e;
  font-size: 0.875rem;
  text-underline-offset: 4px;
}
.error-secondary:hover {
  text-decoration: underline;
}
.error-footer {
  color: #61758f;
  font-size: 0.75rem;
}
@media (max-width: 540px) {
  .error-page {
    padding: 20px 20px 18px;
  }
  .error-brand {
    gap: 7px;
    font-size: 0.9rem;
  }
  .error-brand-mark {
    width: 30px;
    height: 30px;
  }
  .error-catalog-link {
    gap: 4px;
    font-size: 0.75rem;
  }
  .error-content {
    padding-block: 60px;
  }
  .error-description {
    font-size: 0.9rem;
  }
  .error-actions {
    align-items: flex-start;
    flex-direction: column;
    gap: 16px;
  }
  .error-footer {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }
}
</style>
