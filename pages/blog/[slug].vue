<script setup lang="ts">
import type { Article } from "~/shared/article";
const route = useRoute();
const { data: article, error } = await useFetch<Article>(
  "/api/articles/" + route.params.slug,
);
if (!article.value)
  throw createError({
    statusCode: error.value?.statusCode || 404,
    statusMessage: "Статья не найдена",
  });
usePageSeo(
  article.value.seoTitle || article.value.title,
  article.value.seoDescription || article.value.excerpt,
  article.value.image,
);
const config = useRuntimeConfig();
useHead({
  script: [
    {
      type: "application/ld+json",
      innerHTML: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: article.value.title,
        description: article.value.excerpt,
        ...(article.value.image
          ? { image: config.public.siteUrl + article.value.image }
          : {}),
        datePublished: article.value.publishedAt,
        dateModified: article.value.updatedAt,
        author: { "@type": "Organization", name: config.public.siteName },
        mainEntityOfPage: config.public.siteUrl.replace(/\/$/, "") + route.path,
      }).replace(/</g, "\\u003c"),
    },
  ],
});
</script>
<template>
  <article v-if="article" class="article-page">
    <SceneHero
      :image="article.image || '/images/backgrounds/article-fallback.webp'"
      :alt="
        article.image
          ? 'Иллюстрация к статье «' + article.title + '»'
          : 'Блокнот и чашка на столе у окна — атмосферная иллюстрация'
      "
    >
      <NuxtLink to="/blog" class="text-link">← Все статьи</NuxtLink
      ><time v-if="article.publishedAt" :datetime="article.publishedAt">{{
        new Date(article.publishedAt).toLocaleDateString("ru-RU", {
          timeZone: "Europe/Kaliningrad",
        })
      }}</time>
      <h1>{{ article.title }}</h1>
      <p>{{ article.excerpt }}</p>
      <template #aside
        ><small>ЖУРНАЛ · КВАРТИРУКУПИТЬ</small
        ><strong>Квартира в городе<br />и ваш следующий шаг</strong>
        <p>
          Выбор новостройки, проверка документов и жизнь в Калининграде.
        </p></template
      >
    </SceneHero>
    <div class="shell blog-article">
      <aside class="article-note">
        <p class="eyebrow">КАЛИНИНГРАД · НОВОСТРОЙКИ</p>
        <p>Вопросы о покупке.<br />Ответы по делу.</p>
      </aside>
      <div class="article-copy">
        <ArticleBody :content="article.content" />
        <div class="article-end">
          <NuxtLink to="/blog" class="text-link">← Все статьи</NuxtLink>
          <NuxtLink to="/catalog" class="text-link"
            >Выбрать ЖК в Калининграде ↗</NuxtLink
          >
        </div>
      </div>
    </div>
  </article>
</template>
<style scoped>
.blog-article {
  display: grid;
  grid-template-columns: minmax(160px, 0.6fr) minmax(0, 2fr);
  gap: clamp(32px, 7vw, 100px);
  padding-block: clamp(48px, 7vw, 96px);
}
.article-note {
  padding-top: 22px;
  border-top: 1px solid #102f5040;
}
.article-note > p:not(.eyebrow) {
  margin-top: 18px;
  font-size: 14px;
  line-height: 1.8;
  color: #52677d;
}
.article-copy {
  min-width: 0;
  max-width: 760px;
}
.article-copy :deep(.article-body > :first-child) {
  margin-top: 0;
}
.article-copy :deep(.article-body h2) {
  font-family: var(--font-display);
  font-size: clamp(32px, 3vw, 42px);
  line-height: 1.15;
  font-weight: 500;
  letter-spacing: -0.02em;
}
.article-page time {
  display: block;
  margin-top: 24px;
  color: #dce9fc;
  font-size: 12px;
}
.article-end {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 24px;
  margin-top: 48px;
  padding-top: 28px;
  border-top: 1px solid #102f5040;
}
@media (max-width: 700px) {
  .blog-article {
    grid-template-columns: 1fr;
    gap: 32px;
  }
  .article-note > p:not(.eyebrow) {
    display: none;
  }
}
</style>
