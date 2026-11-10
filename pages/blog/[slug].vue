<script setup lang="ts">
import type { Article } from "~/shared/article";
import { combineTagKeywords } from "~/shared/tag";
import RecommendedProjectCard from "~/components/RecommendedProjectCard.vue";
import { ThumbsUp } from "lucide-vue-next";
const route = useRoute();
const { data: article, error } = await useFetch<Article>(
  "/api/articles/" + route.params.slug,
);
if (!article.value)
  throw createError({
    statusCode: error.value?.statusCode || 404,
    statusMessage: "Статья не найдена",
  });
const usefulMarked = ref(false);
const viewState = ref<"loading" | "ready" | "error">("loading");
const usefulPending = ref(false);
const usefulError = ref("");
let viewRequest = 0;

async function recordArticleView(id: string, slug: string) {
  const request = ++viewRequest;
  viewState.value = "loading";
  usefulMarked.value = false;
  usefulError.value = "";
  try {
    const result = await $fetch<{ useful: boolean }>(
      `/api/articles/${encodeURIComponent(slug)}/view`,
      { method: "POST", body: {} },
    );
    if (request !== viewRequest || article.value?.id !== id) return;
    usefulMarked.value = result.useful;
    viewState.value = "ready";
  } catch {
    if (request === viewRequest && article.value?.id === id)
      viewState.value = "error";
  }
}

watch(
  () => article.value?.id,
  (id) => {
    const slug = article.value?.slug;
    if (import.meta.client && id && slug) void recordArticleView(id, slug);
  },
  { immediate: true },
);

async function markArticleUseful() {
  if (!article.value || viewState.value !== "ready" || usefulPending.value)
    return;
  usefulPending.value = true;
  usefulError.value = "";
  try {
    await $fetch(
      `/api/articles/${encodeURIComponent(article.value.slug)}/useful`,
      {
        method: "POST",
        body: {},
      },
    );
    usefulMarked.value = true;
  } catch {
    usefulError.value = "Не удалось сохранить реакцию. Попробуйте ещё раз.";
  } finally {
    usefulPending.value = false;
  }
}
usePageSeo(
  article.value.seoTitle || article.value.title,
  article.value.seoDescription || article.value.excerpt,
  article.value.image,
);
const imageAlt =
  article.value.imageAlt ||
  "Иллюстрация к статье «" + article.value.title + "»";
useSeoMeta({
  keywords:
    combineTagKeywords(
      article.value.seoKeywords,
      article.value.tagRelations?.map(({ tag }) => tag.name) || [],
    ) || undefined,
  ogImageAlt: article.value.image ? imageAlt : undefined,
  twitterImageAlt: article.value.image ? imageAlt : undefined,
});
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
          ? imageAlt
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
        <section
          v-if="article.recommendedArticles?.length"
          class="recommended-articles"
          aria-labelledby="recommended-articles-title"
        >
          <h2 id="recommended-articles-title">Рекомендуемые статьи</h2>
          <NuxtLink
            v-for="recommended in article.recommendedArticles"
            :key="recommended.id"
            :to="'/blog/' + recommended.slug"
            class="recommended-article"
          >
            <img
              :src="
                recommended.image || '/images/backgrounds/article-fallback.webp'
              "
              :alt="
                recommended.image
                  ? recommended.imageAlt ||
                    'Иллюстрация к статье «' + recommended.title + '»'
                  : ''
              "
              loading="lazy"
            />
            <span>{{ recommended.title }}</span>
          </NuxtLink>
        </section>
        <section
          v-if="article.recommendedProjects?.length"
          class="recommended-projects"
          aria-labelledby="recommended-projects-title"
        >
          <h2 id="recommended-projects-title">Рекомендуемые проекты</h2>
          <RecommendedProjectCard
            v-for="project in article.recommendedProjects"
            :key="project.id"
            :project="project"
          />
        </section>
      </aside>
      <div class="article-copy">
        <img
          v-if="article.image"
          class="article-photo"
          :src="article.image"
          :alt="imageAlt"
          :title="article.imageAlt || undefined"
          loading="lazy"
        />
        <ArticleBody :content="article.content" />
        <div class="article-end">
          <NuxtLink to="/blog" class="text-link">← Все статьи</NuxtLink>
          <NuxtLink to="/catalog" class="text-link"
            >Выбрать ЖК в Калининграде ↗</NuxtLink
          >
        </div>
        <div class="article-feedback">
          <p>Эта статья полезна?</p>
          <button
            type="button"
            class="article-feedback-button"
            :class="{ 'is-marked': usefulMarked }"
            aria-label="Отметить статью как полезную"
            :aria-pressed="usefulMarked"
            :disabled="viewState !== 'ready' || usefulPending || usefulMarked"
            @click="markArticleUseful"
          >
            <ThumbsUp :size="19" aria-hidden="true" />
            <span>
              {{
                usefulPending ? "Сохраняем…" : usefulMarked ? "Полезна" : "Да"
              }}
            </span>
          </button>
          <p v-if="usefulMarked" class="article-feedback-status" role="status">
            Спасибо за отзыв!
          </p>
          <p
            v-else-if="viewState === 'error'"
            class="article-feedback-error"
            role="alert"
          >
            Не удалось записать просмотр.
            <button
              type="button"
              class="article-feedback-retry"
              @click="article && recordArticleView(article.id, article.slug)"
            >
              Повторить
            </button>
          </p>
          <p v-if="usefulError" class="article-feedback-error" role="alert">
            {{ usefulError }}
          </p>
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
.recommended-articles {
  display: grid;
  gap: 12px;
  margin-top: 34px;
}
.recommended-articles h2 {
  color: #52677d;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.5;
}
.recommended-article {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 4fr);
  align-items: center;
  gap: 10px;
  color: #354d70;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.45;
}
.recommended-article:hover {
  color: #245fbd;
}
.recommended-article img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 6px;
  object-fit: cover;
  background: #edf2f8;
}
.recommended-projects {
  display: grid;
  gap: 12px;
  margin-top: 30px;
}
.recommended-projects h2 {
  color: #52677d;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.5;
}
.article-copy {
  min-width: 0;
  max-width: 760px;
}
.article-photo {
  display: block;
  width: 100%;
  height: auto;
  margin-bottom: 32px;
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
.article-feedback {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 28px;
  color: #52677d;
  font-size: 14px;
}
.article-feedback-button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 38px;
  border: 1px solid #cdd9e8;
  border-radius: 999px;
  padding: 8px 13px;
  color: #354d70;
  font-size: 13px;
  font-weight: 600;
  transition:
    color 0.15s ease,
    background 0.15s ease,
    border-color 0.15s ease;
}
.article-feedback-button:not(:disabled):hover,
.article-feedback-button.is-marked {
  border-color: #9dbbe4;
  background: #edf4fd;
  color: #245fbd;
}
.article-feedback-button:disabled:not(.is-marked) {
  cursor: wait;
  opacity: 0.65;
}
.article-feedback-status,
.article-feedback-error {
  flex-basis: 100%;
  font-size: 12px;
}
.article-feedback-status {
  color: #287653;
}
.article-feedback-error {
  color: #a33e3e;
}
.article-feedback-retry {
  margin-left: 6px;
  color: #245fbd;
  text-decoration: underline;
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
