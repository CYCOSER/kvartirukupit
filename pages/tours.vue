<script setup lang="ts">
import { ArrowDown, Check } from "lucide-vue-next";

usePageSeo(
  "Туры по новостройкам Калининграда и побережья",
  "Оставьте заявку на тур по новостройкам. Калининград, побережье, пригород или индивидуальный маршрут — подберём жилые комплексы и согласуем время просмотра.",
  "/images/backgrounds/tours-bus.webp",
);
</script>

<template>
  <div class="tours-page">
    <SceneHero
      image="/images/backgrounds/tours-bus.webp"
      alt="Экскурсионный автобус у современного жилого квартала — атмосферная иллюстрация"
    >
      <nav v-reveal class="breadcrumb" aria-label="Хлебные крошки">
        <NuxtLink to="/">Главная</NuxtLink><span aria-hidden="true">/</span>
        <span aria-current="page">Туры по новостройкам</span>
      </nav>
      <p v-reveal class="eyebrow">КАЛИНИНГРАД И ПОБЕРЕЖЬЕ</p>
      <h1 v-reveal="85" class="type-pair">
        <span class="type-upright">Туры</span>
        <em class="type-script">по новостройкам</em>
      </h1>
      <p v-reveal="170">
        Посмотрите будущий дом вживую. Подберём жилые комплексы под ваши
        пожелания и согласуем удобное время для знакомства с ними.
      </p>
      <NuxtLink v-reveal="255" to="/tours#tour-request" class="text-link">
        Оставить заявку <ArrowDown :size="18" aria-hidden="true" />
      </NuxtLink>
      <template #aside>
        <small v-reveal="170">ГОРОД И МОРЕ</small>
        <strong v-reveal="255">Почувствуйте место,<br />где хочется жить.</strong>
        <p v-reveal="340">
          Оцените планировки, прогуляйтесь по двору и познакомьтесь с районом.
          Поможем сравнить варианты и задать вопросы о покупке.
        </p>
      </template>
    </SceneHero>

    <section id="tour-request" class="shell section contact-grid" aria-labelledby="tour-request-title">
      <div class="tour-form">
        <LeadForm tour />
      </div>
      <div v-reveal class="contact-story">
        <p class="eyebrow">01 / ЗАЯВКА НА ТУР</p>
        <h2 id="tour-request-title" class="type-pair">
          <span class="type-upright">Наш маршрут</span>
          <em class="type-script">Для вас</em>
        </h2>
        <p class="tour-intro">
          Выберите тур и оставьте телефон. Начнём с короткого разговора:
          обсудим бюджет, желаемую площадь, количество комнат и сроки покупки.
          Уточним, что для вас важнее — жизнь в городе, спокойствие пригорода
          или близость побережья. По этим пожеланиям подберём новостройки
          и составим маршрут.
        </p>
        <ul class="tour-details">
          <li><Check :size="17" aria-hidden="true" />Посмотрим доступные планировки: расположение комнат, размеры кухни, места для хранения и возможности обустройства квартиры.</li>
          <li><Check :size="17" aria-hidden="true" />Оценим естественное освещение, вид из окон и состояние отделки там, где доступен просмотр выбранной квартиры.</li>
          <li><Check :size="17" aria-hidden="true" />Познакомимся с домом и двором: подъезды, лифты, парковка, прогулочные зоны и места для отдыха.</li>
          <li><Check :size="17" aria-hidden="true" />Обратим внимание на район: транспорт, магазины, школы и повседневные маршруты, которые важны именно вам.</li>
          <li><Check :size="17" aria-hidden="true" />Подготовим вопросы представителю застройщика о наличии квартир, сроках передачи, составе предложения и порядке оплаты.</li>
        </ul>
        <p class="tour-note">
          Во время поездки вы сможете сравнить несколько вариантов по одним и тем же
          критериям, отметить преимущества каждого дома и понять, какие вопросы
          ещё нужно уточнить. Если уже присмотрели конкретный жилой комплекс,
          укажите его в заявке — учтём это при обсуждении маршрута.
        </p>
        <p class="tour-note">
          Напишите в комментарии удобные даты, интересующие районы и ориентир
          по бюджету. Расскажите, для кого выбираете квартиру и что обязательно
          должно быть рядом с домом. После заявки согласуем состав участников,
          время и детали просмотра. Если пока трудно определиться с направлением,
          выберите индивидуальный формат — начнём с ваших пожеланий.
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tours-page :deep(.scene-hero) {
  min-height: max(720px, 85svh);
  align-items: start;
}
.tours-page .contact-grid {
  --tour-gap: clamp(32px, 6vw, 90px);
  display: flow-root;
}
.tour-form {
  float: right;
  width: calc((100% - var(--tour-gap)) / 2);
  margin: 0 0 24px var(--tour-gap);
}
.tours-page .contact-story {
  display: block;
}
.tours-page .contact-story h2 {
  width: calc((100% - var(--tour-gap)) / 2);
  margin-top: 20px;
}
.tours-page .contact-story .type-script {
  color: #789dc6;
  text-decoration: none;
}
.tour-intro,
.tours-page .contact-story .tour-note {
  color: #486285;
  font-size: 15px;
  line-height: 1.9;
}
.tour-intro {
  margin-top: 28px;
}
.tour-note + .tour-note {
  margin-top: 20px;
}
.tour-details {
  margin: 28px 0;
  padding: 0;
  list-style: none;
}
.tour-details li {
  display: flex;
  align-items: start;
  gap: 12px;
  color: #3c526f;
  font-size: 14px;
  line-height: 1.7;
}
.tour-details li + li {
  margin-top: 14px;
}
.tour-details svg {
  flex-shrink: 0;
  margin-top: 3px;
  color: #54749d;
}
@media (max-width: 800px) {
  .tours-page .contact-grid {
    display: flex;
    flex-direction: column;
    gap: 32px;
  }
  .tour-form {
    float: none;
    width: 100%;
    margin: 0;
    order: 1;
  }
  .tours-page .contact-story h2 {
    width: 100%;
  }
}
</style>
