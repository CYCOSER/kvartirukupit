<script setup lang="ts">
defineProps<{ error: any }>();
</script>
<template>
  <NuxtLayout
    ><div class="shell section text-center">
      <p class="eyebrow justify-center">{{ error.statusCode || 500 }}</p>
      <h1 class="my-6 text-4xl">
        {{
          error.statusCode === 404
            ? 'Страница не найдена'
            : 'Не удалось загрузить страницу'
        }}
      </h1>
      <p class="mb-8 text-slate-500">
        {{
          error.statusCode === 404
            ? 'Возможно, ссылка устарела или страница была удалена.'
            : 'Попробуйте обновить страницу немного позже.'
        }}
      </p>
      <button
        class="btn-secondary"
        @click="clearError({ redirect: '/catalog' })"
      >
        Перейти в каталог
      </button>
    </div></NuxtLayout
  >
</template>
