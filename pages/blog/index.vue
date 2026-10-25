<script setup lang="ts">
import type { Article } from "~/shared/article";
usePageSeo(
  "Новостройки Калининграда — журнал покупателя квартиры",
  "Как выбрать квартиру в новостройке Калининграда: проверка ЖК и застройщика, ДДУ, эскроу, планировка и район. Журнал Квартирукупить.",
);
const { data, error } = await useFetch<Article[]>("/api/articles");
</script>
<template>
  <div class="blog-page">
    <SceneHero
      image="/images/backgrounds/journal-hero.webp"
      alt="Уютный уголок для чтения у окна — атмосферная иллюстрация"
    >
      <p v-reveal class="eyebrow">ЖУРНАЛ · КВАРТИРУКУПИТЬ</p>
      <h1 v-reveal="85" class="type-pair">
        <span class="type-upright">Своя квартира</span>
        <em class="type-script">в Калининграде</em>
      </h1>
      <p v-reveal="170">
        Как выбрать новостройку, разобраться в документах и найти свой район.
      </p>
      <a v-reveal="255" href="#journal" class="text-link">Открыть журнал ↓</a>
      <template #aside
        ><small v-reveal="170">КАЛИНИНГРАД · НОВОСТРОЙКИ</small
        ><strong v-reveal="255">От выбора квартиры<br />до получения ключей</strong>
        <p v-reveal="340">
          Как сравнить жилые комплексы, разобраться в условиях покупки
          и подготовиться к переезду.
        </p></template
      >
    </SceneHero>
    <section id="journal" class="shell section">
      <div class="section-heading">
        <div>
          <p class="eyebrow">НА СТРАНИЦАХ ЖУРНАЛА</p>
          <h2>Квартира<br /><em>и жизнь в городе</em></h2>
        </div>
        <p class="section-aside">Выбор · Документы · Районы · Планировки</p>
      </div>
      <p v-if="error" role="alert">
        Не удалось загрузить статьи. Попробуйте обновить страницу.
      </p>
      <div v-else-if="data?.length" class="blog-grid">
        <NuxtLink
          v-for="(article, i) in data"
          v-reveal="(i % 2) * 70"
          :key="article.id"
          :to="'/blog/' + article.slug"
          class="blog-card"
          ><img
            v-if="article.image"
            :src="article.image"
            :alt="'Иллюстрация к статье «' + article.title + '»'"
            class="blog-card-image"
            width="720"
            height="480"
            loading="lazy"
          />
          <div class="blog-card-meta">
            <span>{{ String(i + 1).padStart(2, "0") }} / ЖУРНАЛ</span>
            <time v-if="article.publishedAt" :datetime="article.publishedAt">{{
              new Date(article.publishedAt).toLocaleDateString("ru-RU", {
                timeZone: "Europe/Kaliningrad",
              })
            }}</time>
          </div>
          <h2>{{ article.title }}</h2>
          <p>{{ article.excerpt }}</p>
          <span class="blog-card-link">Читать статью ↗</span></NuxtLink
        >
      </div>
      <div v-else v-reveal="100" class="journal-empty">
        <img
          src="/images/journal-morning.webp"
          alt="Иллюстрация светлого жилого интерьера"
          width="1672"
          height="941"
          loading="lazy"
        />
        <div class="journal-empty-copy">
          <p class="eyebrow">КАТАЛОГ НОВОСТРОЕК</p>
          <h2>Выберите свою<br /><em>квартиру</em></h2>
          <p>
            Статей пока нет. Посмотрите жилые комплексы Калининграда
            и сравните районы, планировки и условия покупки.
          </p>
          <NuxtLink to="/catalog" class="text-link mt-5"
            >Посмотреть новостройки ↗</NuxtLink
          >
        </div>
      </div>
    </section>
  </div>
</template>
<style scoped>
.journal-empty em {
  color: #245fbd;
  font-family: var(--font-display);
  font-style: italic;
}
.journal-empty {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: clamp(28px, 6vw, 88px);
  padding-block: 32px;
  border-block: 1px solid #102f5026;
}
.journal-empty > img {
  height: 100%;
  width: 100%;
  object-fit: cover;
  min-height: 320px;
  aspect-ratio: 4 / 3;
}
.journal-empty-copy {
  align-self: center;
  max-width: 380px;
}
.journal-empty-copy h2 {
  margin: 24px 0;
}
.journal-empty-copy > p:not(.eyebrow) {
  color: #52677d;
  line-height: 1.8;
}
.journal-empty-copy .text-link {
  width: fit-content;
}
.blog-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 56px 40px;
}
.blog-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding-bottom: 28px;
  border-bottom: 1px solid #102f5040;
}
.blog-card-meta {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-top: 24px;
  font-size: 11px;
  letter-spacing: 0.1em;
  color: #52677d;
}
.blog-card-image {
  width: 100%;
  aspect-ratio: 3 / 2;
  object-fit: cover;
}
.blog-card h2 {
  font-family: var(--font-display);
  font-size: clamp(30px, 2.8vw, 38px);
  line-height: 1.15;
  font-weight: 500;
  letter-spacing: -0.02em;
  margin: 18px 0 14px;
}
.blog-card p {
  max-width: 500px;
  font-size: 15px;
  line-height: 1.8;
  color: #52677d;
}
.blog-card-link {
  padding-top: 28px;
  margin-top: auto;
  font-size: 12px;
  color: #245fbd;
}
.blog-card:hover {
  translate: none;
  border-color: #245fbd;
}
.blog-card:hover .blog-card-link {
  text-decoration: underline;
  text-underline-offset: 6px;
}
@media (max-width: 700px) {
  .journal-empty {
    grid-template-columns: 1fr;
    padding-block: 24px;
  }
  .journal-empty > img {
    min-height: 0;
    height: auto;
  }
  .blog-grid {
    grid-template-columns: 1fr;
    gap: 36px;
  }
}
</style>
