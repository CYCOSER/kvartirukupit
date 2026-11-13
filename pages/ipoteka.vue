<script setup lang="ts">
import { Plus } from "lucide-vue-next";
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from "reka-ui";

const config = useRuntimeConfig();
usePageSeo(
  "Ипотека на новостройки в Калининграде — программы и расчёт",
  "Покупка квартиры в ипотеку в Калининграде: семейная и ИТ-ипотека, расчёт платежа, первоначальный взнос и документы. Подбор новостройки под ваш бюджет.",
  "/images/backgrounds/home-contact.webp",
);
useHead({
  script: [
    {
      type: "application/ld+json",
      innerHTML: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Главная",
            item: config.public.siteUrl.replace(/\/$/, "") + "/",
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Ипотека",
            item: config.public.siteUrl.replace(/\/$/, "") + "/ipoteka",
          },
        ],
      }).replace(/</g, "\\u003c"),
    },
  ],
});

const programs = [
  {
    title: "Семейная ипотека",
    text: "Для семей с детьми, которые соответствуют условиям программы. Возможность участия зависит от состава семьи, выбранного жилья и действующих правил.",
    link: "/blog/semeynaya-ipoteka-kaliningrad",
    source: "Как купить квартиру по семейной ипотеке",
  },
  {
    title: "ИТ-ипотека",
    text: "Для сотрудников ИТ-компаний, отвечающих требованиям программы. Банк проверяет работодателя, доход и другие условия участия.",
    link: "/blog/it-ipoteka-kaliningrad",
    source: "Что проверить перед оформлением ИТ-ипотеки",
  },
  {
    title: "Базовые программы",
    text: "Если льготные программы не подходят, сравните предложения банков. Учитывайте полную стоимость кредита, размер взноса, страхование и условия сохранения ставки.",
    link: "/blog/kak-sravnit-ipotechnye-programmy",
    source: "Как сравнить ипотечные программы",
  },
];
const banks = [
  { name: "Сбер", logo: "sber" },
  { name: "ВТБ", logo: "vtb" },
  { name: "Альфа-Банк", logo: "alfa" },
  { name: "Газпромбанк", logo: "gazprombank" },
  { name: "ПСБ", logo: "psb" },
  { name: "Россельхозбанк", logo: "rshb" },
  { name: "Совкомбанк", logo: "sovcombank" },
  { name: "Банк Санкт-Петербург", logo: "bspb" },
  { name: "Райффайзенбанк", logo: "raiffeisen" },
  { name: "Т-Банк", logo: "tbank" },
];
const questions = [
  {
    title: "Сначала выбрать квартиру или получить одобрение?",
    text: "Начните с бюджета и предварительной оценки условий кредита. Затем выбирайте квартиру в пределах доступной суммы. Одобрение заёмщика не означает одобрения любой квартиры: банк отдельно проверяет объект и документы по сделке.",
  },
  {
    title: "Какой первоначальный взнос нужен?",
    text: "Размер взноса зависит от банка и программы. Уточните его до бронирования квартиры. Помимо взноса, предусмотрите расходы на оформление, страхование, ремонт и финансовый резерв.",
  },
  {
    title: "Какие документы подготовить?",
    text: "Обычно нужны паспорт, сведения о доходах и занятости, а для льготной программы — подтверждение права на участие. Точный список зависит от банка и вашей ситуации. Документы передавайте банку через его защищённые каналы.",
  },
  {
    title: "Расчёт калькулятора совпадёт с предложением банка?",
    text: "Калькулятор показывает ориентировочный платёж по указанным вами параметрам. Он не учитывает страхование, комиссии и другие расходы. Окончательные условия и решение о выдаче кредита определяет банк.",
  },
  {
    title: "Можно ли купить новостройку в Калининграде в ипотеку?",
    text: "Да, квартиры от застройщиков можно приобретать с использованием ипотечного кредита, если объект и заёмщик соответствуют требованиям банка.",
  },
  {
    title: "Какой первоначальный взнос нужен для ипотеки?",
    text: "Размер зависит от выбранной программы и условий конкретного банка.",
  },
  {
    title: "Можно ли сначала одобрить ипотеку, а потом выбрать квартиру?",
    text: "Да. Предварительное одобрение помогает определить бюджет покупки и подобрать подходящую недвижимость.",
  },
];
</script>

<template>
  <div class="mortgage-page">
    <SceneHero
      class="scene-intro"
      image="/images/backgrounds/home-contact.webp"
      alt="Светлая гостиная — иллюстрация будущего дома"
    >
      <div v-reveal class="breadcrumb">
        <NuxtLink to="/">Главная</NuxtLink><span>/ Ипотека</span>
      </div>
      <p v-reveal class="eyebrow">ПОКУПКА КВАРТИРЫ · КАЛИНИНГРАД</p>
      <h1 v-reveal="85" class="type-pair">
        <span class="type-upright">Ипотека на новостройки</span
        ><em class="type-script">в Калининграде</em>
      </h1>
      <p v-reveal="170">
        Своя квартира начинается с понятного бюджета. Рассчитайте платёж,
        разберитесь в программах и выберите новостройку под свои планы.
      </p>
      <NuxtLink v-reveal="255" to="/ipoteka#mortgage" class="text-link">Рассчитать платёж ↓</NuxtLink>
      <template #aside>
        <small v-reveal="170">ОТ ПЛАНОВ К ПОКУПКЕ</small>
        <strong v-reveal="255">Сначала возможности.<br />Потом — ваша квартира.</strong>
        <p v-reveal="340">
          Подберем оптимальные условия в 20+ банках, проведем переговоры, проверим
          документы, поможем с их оформлением и с экономией на страховке. Найдем
          выход в любой ситуации, сбережем ваш бюджет и ваше время.
        </p>
      </template>
    </SceneHero>

    <section class="shell section" aria-labelledby="programs-title">
      <div v-reveal class="section-heading">
        <div>
          <p class="eyebrow">01 / ВАРИАНТЫ ФИНАНСИРОВАНИЯ</p>
          <h2 id="programs-title" class="type-pair">
            <span class="type-upright">Под ваши планы</span
            ><em class="type-script">и бюджет</em>
          </h2>
        </div>
        <p class="section-aside">
          Программа зависит от вашей ситуации.<br />Условия и решение определяет
          банк.
        </p>
      </div>
      <div class="steps">
        <div v-for="(program, i) in programs" :key="program.title" v-reveal="i * 70">
          <span aria-hidden="true">0{{ i + 1 }}</span>
          <h3>{{ program.title }}</h3>
          <p>{{ program.text }}</p>
          <NuxtLink :to="program.link" class="program-source"
            >{{ program.source }} ↗</NuxtLink>
        </div>
      </div>
    </section>

    <section class="shell section purchase-section" aria-labelledby="purchase-title">
      <div v-reveal class="section-heading">
        <div>
          <p class="eyebrow">02 / ИПОТЕКА С НАМИ</p>
          <h2 id="purchase-title" class="type-pair">
            <span class="type-upright">Ипотека проще</span
            ><em class="type-script">вместе с нами</em>
          </h2>
        </div>
        <div class="purchase-banks" aria-labelledby="banks-title">
          <h3 id="banks-title" class="eyebrow" aria-label="Партнёры">
            <span aria-hidden="true">Парт<span class="bank-letter-small">н</span>ёр<span class="bank-letter-small">ы</span></span>
          </h3>
          <TooltipProvider :delay-duration="150">
            <ul class="bank-list">
              <li v-for="(bank, index) in banks" :key="bank.logo">
                <TooltipRoot>
                  <TooltipTrigger type="button" class="bank-logo" :aria-label="bank.name">
                    <img
                      :src="'/images/banks/' + bank.logo + '.webp'"
                      alt=""
                      width="56"
                      height="56"
                      loading="lazy"
                    />
                  </TooltipTrigger>
                  <TooltipPortal>
                    <TooltipContent class="bank-tooltip" :side="index < 5 ? 'top' : 'bottom'" :side-offset="8" :collision-padding="12">
                      {{ bank.name }}
                    </TooltipContent>
                  </TooltipPortal>
                </TooltipRoot>
              </li>
            </ul>
          </TooltipProvider>
        </div>
      </div>
      <div class="steps">
        <div v-reveal>
          <span aria-hidden="true">01</span>
          <h3>Расскажите о планах</h3>
          <p>
            Обсудим стоимость квартиры, первоначальный взнос и комфортный платёж.
            Поможем понять, какие программы подходят вам и с чего начать оформление.
          </p>
        </div>
        <div v-reveal="70">
          <span aria-hidden="true">02</span>
          <h3>Сравним предложения банков</h3>
          <p>
            Изучим доступные условия банков-партнёров: ставку, полную стоимость
            кредита и дополнительные расходы. Вам будет проще сравнить варианты
            и принять решение.
          </p>
        </div>
        <div v-reveal="140">
          <span aria-hidden="true">03</span>
          <h3>Выберем выгодные условия</h3>
          <p>
            Подберём наиболее выгодный вариант среди полученных предложений.
            Поможем разобраться с документами и следующими шагами к покупке квартиры.
          </p>
        </div>
      </div>
      <p class="purchase-disclaimer">
        Ипотечные кредиты предоставляются банками-партнёрами. Мы помогаем с подбором
        квартиры и ипотечной программы, но не выступаем кредиторами.
        Решение о выдаче кредита и его условия определяет банк.
      </p>
      <NuxtLink to="/ipoteka#contact" class="text-link purchase-link">Подобрать условия ипотеки ↗</NuxtLink>
    </section>

    <UnfoldSection class="mortgage-unfold">
      <section class="shell section calculator-section" aria-label="Расчёт ипотеки">
        <MortgageCalculator :price="null" />
        <NuxtLink to="/catalog" class="text-link catalog-link"
          >Выбрать новостройку в Калининграде ↗</NuxtLink>
      </section>
    </UnfoldSection>

    <section
      class="shell section questions-section"
      aria-labelledby="questions-title"
    >
      <div class="questions-layout">
        <div v-reveal class="questions-intro">
          <div class="section-heading">
            <div>
              <p class="eyebrow">ОТВЕЧАЕМ НА ГЛАВНОЕ</p>
              <h2 id="questions-title" class="type-pair">
                <span class="type-upright">Вопросы</span>
                <em class="type-script">об ипотеке</em>
              </h2>
            </div>
          </div>
          <p class="questions-description">
            С чего начать, что подготовить и на что обратить внимание.
            Разбираемся спокойно, шаг за шагом.
          </p>
          <NuxtLink to="/ipoteka#contact" class="text-link">Обсудить вашу ситуацию ↗</NuxtLink>
        </div>
        <div class="questions-list">
          <details v-for="(question, i) in questions" :key="question.title" v-reveal="i * 70">
            <summary>
              <span class="question-number" aria-hidden="true">0{{ i + 1 }}</span>
              <span>{{ question.title }}</span>
              <span class="question-toggle" aria-hidden="true"><Plus :size="18" /></span>
            </summary>
            <p>{{ question.text }}</p>
          </details>
          <NuxtLink to="/blog" class="questions-journal">Больше о покупке квартиры — в журнале ↗</NuxtLink>
        </div>
      </div>
    </section>

    <section
      id="contact"
      class="contact-section"
      aria-labelledby="contact-title"
    >
      <div class="shell contact-grid">
        <div class="contact-story">
          <p v-reveal class="eyebrow">ЛИЧНЫЙ ПОДБОР</p>
          <h2 v-reveal="85" id="contact-title" class="type-pair">
            <span class="type-upright">Найдём квартиру</span
            ><em class="type-script">ваш бюджет</em>
          </h2>
          <p v-reveal="170" class="contact-story-intro">
            Расскажите, какую квартиру ищете и планируете ли ипотеку. Обсудим
            районы, новостройки и следующие шаги к покупке.
          </p>
          <p>
            В комментарии можно указать бюджет и удобный ежемесячный платёж. Для
            первого разговора документы не нужны.
          </p>
        </div>
        <LeadForm />
      </div>
    </section>
  </div>
</template>

<style scoped>
.mortgage-page {
  background: #e5ecf5;
  color: #18355a;
}
.mortgage-page .section {
  padding-block: clamp(48px, 7vw, 88px);
}
.mortgage-page .section + .section {
  border-top: 1px solid #bbc8da;
}
.mortgage-page .section-heading > div {
  min-width: 0;
  max-width: 100%;
}
.mortgage-page .section-heading h2 {
  font-size: clamp(28px, 3.9vw, 48px);
}
.mortgage-page .steps {
  gap: 0;
  margin-top: 0;
}
.mortgage-page .steps > div {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 20px 28px;
  border: 0;
  border-left: 1px solid #bbc8da;
  background: transparent;
}
.mortgage-page .steps > div:first-child {
  border-left: 0;
  padding-left: 0;
}
.mortgage-page .steps > div:last-child {
  padding-right: 0;
}
.mortgage-page .steps > div > span {
  color: #607ca2;
  font-family: var(--font-display);
  font-size: 32px;
  font-weight: 400;
}
.mortgage-page .steps h3 {
  letter-spacing: 0;
}
.mortgage-page .steps p {
  max-width: none;
  color: #486285;
}
.program-source {
  margin-top: auto;
  padding-top: 24px;
  font-size: 12px;
  text-decoration: underline;
  text-underline-offset: 4px;
  line-height: 1.7;
}
.catalog-link {
  width: fit-content;
  margin-top: 28px;
}
.mortgage-page .mortgage-unfold {
  clip-path: inset(0);
  background: transparent;
}
.mortgage-unfold :deep(.unfold-content) {
  background:
    linear-gradient(90deg, #0d1c30c4, #12294680),
    url("/images/mortgage-planning.webp") center / cover;
}
.calculator-section .catalog-link {
  color: #f2f6fb;
  border-color: #ffffff70;
}
.mortgage-page .calculator-section {
  max-width: 1040px;
  padding-block: 32px;
}
.calculator-section :deep(.mortgage) {
  background: #f5f8fcf0;
  margin: 0;
  padding: clamp(20px, 2.5vw, 28px);
}
.calculator-section :deep(.mortgage-grid) {
  margin-top: 20px;
}
.calculator-section :deep(.mortgage-fields) {
  gap: 16px;
}
.calculator-section :deep(.mortgage-result) {
  padding: 20px;
}
.calculator-section :deep(.mortgage dl > div) {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: 2px 16px;
  margin-top: 10px;
}
.calculator-section :deep(.mortgage dd) {
  margin-left: auto;
  text-align: right;
}
@media (min-width: 801px) {
  .calculator-section :deep(.mortgage-grid) {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
.purchase-banks {
  flex: 0 1 560px;
  width: 100%;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 24px;
}
.purchase-banks .eyebrow {
  margin: 0;
  writing-mode: vertical-rl;
  text-orientation: upright;
  text-transform: uppercase;
  white-space: nowrap;
}
.bank-letter-small {
  display: inline-block;
  transform: scale(0.94);
}
.bank-list {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 24px 18px;
}
.bank-list li {
  display: grid;
  place-items: center;
  min-width: 0;
}
.bank-logo {
  display: grid;
  place-items: center;
  width: 100%;
  max-width: 64px;
  height: 64px;
  padding: 4px;
  background: transparent;
  border: 0;
  cursor: help;
}
.bank-list img {
  width: 56px;
  height: 56px;
  object-fit: contain;
}
:global(.bank-tooltip) {
  z-index: 100;
  max-width: calc(100vw - 24px);
  padding: 8px 12px;
  border-radius: 6px;
  background: #18355a;
  color: #fff;
  font-size: 12px;
  line-height: 1.4;
}
.purchase-disclaimer {
  margin: 28px 0 0;
  color: #486285;
  font-size: 14px;
  line-height: 1.9;
}
.purchase-link {
  width: fit-content;
  margin-top: 32px;
}
.questions-layout {
  --questions-gap: clamp(32px, 6vw, 88px);
  display: flow-root;
}
.questions-intro {
  float: left;
  width: calc((100% - var(--questions-gap)) * 0.4);
  margin: 0 var(--questions-gap) 28px 0;
}
.questions-intro .section-heading {
  margin-bottom: 24px;
}
.questions-description {
  max-width: 310px;
  color: #486285;
  font-size: 14px;
  line-height: 1.9;
}
.questions-intro .text-link {
  width: fit-content;
  margin-top: 28px;
}
.questions-section details {
  display: flow-root;
  margin-bottom: 12px;
  border: 1px solid #bbc8da;
  border-radius: 12px;
  background: #ffffff38;
}
.questions-section details:hover {
  border-color: #8ea8c9;
}
.questions-section details[open] {
  background: #f5f8fc;
  border-color: #8ea8c9;
}
.questions-section summary {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 32px;
  align-items: center;
  gap: 16px;
  padding: 22px 24px;
  cursor: pointer;
  list-style: none;
  font-size: 16px;
  line-height: 1.6;
}
.questions-section summary::-webkit-details-marker {
  display: none;
}
.questions-section summary:focus-visible {
  outline: 2px solid #476184;
  outline-offset: 4px;
  border-radius: 12px;
}
.question-number {
  color: #7098c8;
  font-family: var(--font-display);
  font-size: 22px;
  line-height: 1;
  white-space: nowrap;
}
.question-toggle {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid #bdcde0;
  border-radius: 50%;
  color: #476184;
}
.questions-section details[open] .question-toggle {
  color: #fff;
  background: #476184;
  border-color: #476184;
  transform: rotate(45deg);
}
.questions-section details p {
  margin: 0 24px 24px 66px;
  padding-top: 18px;
  border-top: 1px solid #d6e0ec;
  color: #486285;
  font-size: 14px;
  line-height: 1.9;
}
.questions-journal {
  display: inline-block;
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.8;
  text-decoration: underline;
  text-underline-offset: 4px;
}
@media (prefers-reduced-motion: no-preference) {
  .question-toggle {
    transition: transform 180ms, background-color 180ms;
  }
}
.mortgage-page .contact-section {
  position: relative;
  isolation: isolate;
  clip-path: inset(0);
  background: #102f50;
}
.mortgage-page .contact-section::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    linear-gradient(90deg, #0d1c30db, #122946a6),
    url("/images/backgrounds/home-contact.webp") center / cover;
}
.mortgage-page .contact-story {
  justify-content: center;
}
.mortgage-page .contact-story h2 em {
  color: #ccd6e3;
  text-decoration: none;
  overflow-wrap: anywhere;
}
@media (max-width: 800px) {
  .questions-intro {
    float: none;
    width: auto;
    margin: 0 0 32px;
  }
  .mortgage-page .steps {
    grid-template-columns: 1fr;
  }
  .mortgage-page .steps > div,
  .mortgage-page .steps > div:first-child,
  .mortgage-page .steps > div:last-child {
    padding: 24px 0;
    border-left: 0;
  }
  .mortgage-page .steps > div + div {
    border-top: 1px solid #bbc8da;
  }
  .mortgage-page .section-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .purchase-banks {
    flex-basis: auto;
  }
}
@media (max-width: 540px) {
  .purchase-banks {
    gap: 12px;
  }
  .bank-list {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 20px 12px;
  }
  .bank-logo {
    max-width: 56px;
    height: 56px;
    padding-inline: 0;
  }
  .bank-list img {
    width: 48px;
    height: 48px;
  }
  .questions-section summary {
    gap: 10px;
    padding: 18px 16px;
    font-size: 14px;
  }
  .questions-section details p {
    margin: 0 16px 20px;
  }
}
</style>
