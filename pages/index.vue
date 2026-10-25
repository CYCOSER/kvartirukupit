<script setup lang="ts">
import { ArrowUpRight, ArrowDown, LayoutGrid, MapPin, Check } from "lucide-vue-next";
import type { Property } from "~/shared/property";
usePageSeo(
  "Квартиры в Калининграде — продажа и подбор",
  "Новостройки Калининграда: жилые комплексы, планировки и цены. Поможем сравнить варианты, выбрать район и договориться о просмотре.",
);
const { data, error } = await useFetch<{ items: Property[] }>(
  "/api/properties/random",
);
const home = ref<HTMLElement>();
let observer: IntersectionObserver | undefined;
let motionPreference: MediaQueryList | undefined;
const activeAnimations = new Set<Animation>();
function stopMotion() {
  observer?.disconnect();
  activeAnimations.forEach((animation) => animation.cancel());
  activeAnimations.clear();
}
function reveal(element: Element, delay = 0) {
  if (motionPreference?.matches || !("animate" in element)) return;
  // SSR content is already painted: never dim it again when hydration/scroll starts.
  const animation = element.animate(
    [{ transform: "translateY(14px)" }, { transform: "translateY(0)" }],
    {
      duration: 680,
      delay,
      easing: "cubic-bezier(.22,1,.36,1)",
      fill: "backwards",
    },
  );
  activeAnimations.add(animation);
  animation.onfinish = () => {
    activeAnimations.delete(animation);
    animation.cancel();
  };
}
function onMotionChange() {
  if (motionPreference?.matches) stopMotion();
}
onMounted(() => {
  motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  motionPreference.addEventListener("change", onMotionChange);
  if (motionPreference.matches || !home.value) return;
  const root = home.value;
  const hero = root.querySelector(".hero-stage");
  // Do not replay the opening sequence when landing directly on a section.
  if (
    !window.location.hash &&
    hero &&
    hero.getBoundingClientRect().bottom > 0
  ) {
    root
      .querySelectorAll(
        ".hero-copy > .eyebrow, .hero-copy h1, .hero-bottom p, .hero-scroll",
      )
      .forEach((element, i) => reveal(element, i * 85));
  }
  if (!("IntersectionObserver" in window)) return;
  const targets = root.querySelectorAll(
    ".section-heading, .coast-heading, .coast-intro, .coast-fact, .steps > div, .contact-story > .eyebrow, .contact-story h2, .contact-story-intro, .contact-topics, .lead-form",
  );
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        observer?.unobserve(entry.target);
        const siblings = entry.target.parentElement?.children;
        const stagger =
          entry.target.matches(".steps > div, .coast-fact") && siblings
            ? (Array.from(siblings).indexOf(entry.target) % 3) * 80
            : 0;
        // Never move a control while the visitor is typing or using the keyboard.
        if (!entry.target.contains(document.activeElement))
          reveal(entry.target, stagger);
      });
    },
    { threshold: 0.12 },
  );
  targets.forEach((element) => observer?.observe(element));
});
onBeforeUnmount(() => {
  stopMotion();
  motionPreference?.removeEventListener("change", onMotionChange);
});
</script>
<template>
  <div ref="home" class="home-motion">
    <section class="hero-stage" aria-labelledby="home-title">
      <img
        class="hero-backdrop"
        src="/images/backgrounds/home-hero.webp"
        alt="Архитектура и зелёный двор — атмосферная иллюстрация"
        width="1672"
        height="941"
        fetchpriority="high"
      />
      <div class="hero-overlay" />
      <div class="hero shell">
        <div class="hero-copy">
          <p class="eyebrow">
            <span class="small-line" /> НОВОСТРОЙКИ КАЛИНИНГРАДА
          </p>
          <h1 id="home-title" class="type-pair">
            <span class="type-upright">Жить красиво</span>
            <em class="type-script">В своей квартире</em>
          </h1>
          <div class="hero-bottom">
            <p>
              Удобная планировка, любимый район и место для близких.<br />
            Найдите свою квартиру в новостройках Калининграда.
            </p>
          </div>
        </div>
        <NuxtLink to="/catalog" class="hero-primary">
          <span>Открыть коллекцию</span>
          <span class="hero-primary-icon"
            ><LayoutGrid :size="20" aria-hidden="true"
          /></span>
        </NuxtLink>
        <div class="hero-foot">
          <a href="#collection" class="hero-scroll">
            <ArrowDown :size="17" aria-hidden="true" /> Жилые комплексы
          </a>
          <span class="hero-geography"
            ><MapPin :size="13" aria-hidden="true" /> Калининград</span
          >
        </div>
      </div>
    </section>
    <UnfoldSection id="collection">
      <section class="section collection-section">
        <div class="section-heading collection-heading shell">
          <div>
            <p class="eyebrow">01 / КОЛЛЕКЦИЯ НОВОСТРОЕК</p>
            <h2 class="type-pair">
              <span class="type-upright">Жилые комплексы</span>
              <em class="type-script">Для вашей жизни</em>
            </h2>
          </div>
          <NuxtLink to="/catalog" class="text-link"
            >Вся коллекция <ArrowUpRight :size="21"
          /></NuxtLink>
        </div>
        <p v-if="error" class="empty-state">
          Не удалось загрузить каталог. Попробуйте обновить страницу.
        </p>
        <PropertyCarousel v-else-if="data?.items.length" :items="data.items" />
        <p v-else class="empty-state">В каталоге пока нет новостроек.</p>
      </section>
    </UnfoldSection>
    <section
      id="location"
      class="location-section scene-edge-shade"
      aria-labelledby="coast-title"
    >
      <div class="location-backdrop" aria-hidden="true" />
      <div class="shell coast-lead">
        <div class="coast-heading">
          <p class="eyebrow">02 / ГОРОД ДЛЯ ЖИЗНИ</p>
          <h2 id="coast-title" class="type-pair">
            <span class="type-upright">Калининград</span>
            <em class="type-script">В ритме Балтики</em>
          </h2>
        </div>
        <div class="coast-intro">
          <p>
            Исторические кварталы, набережные Преголи и новые жилые районы.
            Выбирайте место с учётом дороги на работу, близости школ и парков,
            а также того, что важно вам каждый день. А на выходных можно отправиться к морю.
          </p>
          <NuxtLink to="/catalog" class="location-link"
            >Выбрать квартиру в городе
            <ArrowUpRight :size="18" aria-hidden="true"
          /></NuxtLink>
        </div>
      </div>
      <div class="shell coast-facts">
        <div class="coast-fact">
          <p class="eyebrow">АРХИТЕКТУРА И СРЕДА</p>
          <h3>Город с характером</h3>
          <p>
            У каждого района своё окружение: тихие улицы, оживлённый центр
            или новые кварталы. На каждый вкус найдётся подходящее место, и даже не одно.
          </p>
        </div>
        <div class="coast-fact">
          <p class="eyebrow">ПОВСЕДНЕВНЫЙ КОМФОРТ</p>
          <h3>Квартира для вашей жизни</h3>
          <p>
            Удобная планировка и простор для семьи, работы и отдыха.
            Подберём квартиру, которая была создана для вас.
          </p>
        </div>
        <div class="coast-fact">
          <p class="eyebrow">ГОРОД НА БЕРЕГУ МОРЯ</p>
          <h3>Жизнь у моря</h3>
          <p>
            Курортные города Калининградской области развиваются всё быстрее с каждым годом. Возможно, именно там
            находится квартира вашей мечты.
          </p>
        </div>
      </div>
    </section>
    <UnfoldSection id="process">
      <section class="section shell">
        <div class="section-heading">
          <div>
            <p class="eyebrow">03 / ЛИЧНЫЙ ПОДБОР</p>
            <h2 class="type-pair">
              <span class="type-upright">Индивидуальный подход</span>
              <em class="type-script">К вашим требованиям</em>
            </h2>
          </div>
          <p class="section-aside">
            Внимание к вашим приоритетам<br />от первого разговора до покупки.
          </p>
        </div>
        <div class="steps">
          <div
            v-for="(step, i) in [
              {
                title: 'Слушаем',
                text: 'Обсудим, какую квартиру вы ищете. Составим подборку новостроек в Калининграде под ваши личные требования.',
                details: [
                  'Площадь, планировка и бюджет',
                  'Район, окружение, инфраструктура',
                  'Состояние, отделка и готовность к переезду',
                ],
                result:
                  'Подборка новостроек, соответствующих вашим приоритетам.',
              },
              {
                title: 'Показываем',
                text: 'Договоримся о просмотрах. Покажем жилой комплекс, поможем взвесить все за и против.',
                details: [
                  'Освещение, размеры комнат и материалы',
                  'Двор, подъезд, вид из окна',
                  'Инженерные системы и вопросы застройщику',
                ],
                result: 'Впечатления от просмотра и информация для взвешенного выбора.',
              },
              {
                title: 'Готовимся к покупке',
                text: 'Поможем с оформлением документов, условиями по ипотеке, проработаем каждый шаг.',
                details: [
                  'Цена, состав предложения и сроки передачи',
                  'Перечень документов и порядок расчётов',
                  'Порядок оформления и передачи ключей',
                  'Возможность получения льготных условий'
                ],
                result: 'Сделка по самым подходящим для вас условиям.',
              },
            ]"
            :key="i"
          >
            <span>0{{ i + 1 }}</span>
            <h3>{{ step.title }}</h3>
            <p>{{ step.text }}</p>
            <ul class="step-details">
              <li v-for="detail in step.details" :key="detail">
                <Check :size="15" aria-hidden="true" />{{ detail }}
              </li>
            </ul>
            <div class="step-result">
              <small>В РЕЗУЛЬТАТЕ</small>
              <p>{{ step.result }}</p>
            </div>
          </div>
        </div>
        <div class="process-next">
          <p>
            У каждой квартиры — свой характер.<br /><span
              >Расскажите, что важно вам. С этого и начнём подбор.</span
            >
          </p>
          <NuxtLink to="/#contact" class="text-link"
            >Обсудить подбор <ArrowUpRight :size="20"
          /></NuxtLink>
        </div>
      </section>
    </UnfoldSection>
    <section id="contact" class="contact-section scene-edge-shade">
      <div class="contact-backdrop" aria-hidden="true" />
      <div class="shell contact-grid">
        <div class="contact-story">
          <p class="eyebrow">ВАШ ЛИЧНЫЙ ПОДБОР</p>
          <h2 class="type-pair">
            <span class="type-upright">Начнём</span>
            <em class="type-script">с разговора</em>
          </h2>
          <p class="contact-story-intro">
            Расскажите, какую квартиру вы ищете в Калининграде. Обсудим район,
            планировку и комфортный бюджет.
          </p>
          <div class="contact-topics" aria-label="С чем мы поможем">
            <span><Check :size="15" aria-hidden="true" />Личная подборка</span>
            <span
              ><Check :size="15" aria-hidden="true" />Район и планировка</span
            >
            <span><Check :size="15" aria-hidden="true" />Условия покупки</span>
            <span><Check :size="15" aria-hidden="true" />Личный просмотр</span>
          </div>
        </div>
        <LeadForm />
      </div>
    </section>
  </div>
</template>
<style scoped>
.home-motion {
  overflow-anchor: none;
  --ink: #102f50;
  color: var(--ink);
  background: #f2f6fb;
}
.home-motion .shell {
  width: min(1320px, calc(100% - 96px));
}
.home-motion .section {
  padding-block: 80px;
}
.home-motion .eyebrow {
  color: #527097;
  font-size: 10px;
  letter-spacing: 0.16em;
}
.home-motion h2 {
  font-size: clamp(30px, 3.2vw, 46px);
  line-height: 1.1;
  font-weight: 400;
  letter-spacing: 0;
}
.home-motion h2 em {
  color: #54749d;
}
.home-motion .text-link {
  color: #1d3f6c;
  font-size: 12px;
  border-bottom: 1px solid #708db2;
  padding-bottom: 10px;
  background-image: none;
}
.hero-stage {
  position: relative;
  isolation: isolate;
  clip-path: inset(0);
  overflow: hidden;
  background: #173357;
}
.hero-backdrop,
.hero-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.hero-backdrop {
  position: fixed;
  object-fit: cover;
  object-position: center;
  z-index: -2;
}
.hero-overlay {
  z-index: -1;
  background:
    linear-gradient(90deg, #0c1a2dc9, #0d1d3135 60%, #0c192b12),
    linear-gradient(0deg, #0c1b2ecc, transparent 40%, #0d1c2f40);
}
.home-motion .hero {
  min-height: 100svh;
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: 1fr auto auto;
  gap: 28px;
  padding: clamp(140px, 18svh, 180px) 0 28px;
}
.home-motion .hero-copy {
  max-width: 960px;
  align-self: center;
  padding: 0;
}
.home-motion .hero-stage .eyebrow {
  color: #e1e9f3;
}
.hero-stage .small-line {
  background: #bbc9db;
  width: 28px;
  height: 1px;
}
.home-motion .hero h1 {
  --script-indent: 0.75em;
  --script-scale: 1.3;
  margin-top: 36px;
  font-size: clamp(52px, 6.3vw, 92px);
  line-height: 1.15;
  letter-spacing: 0;
  text-transform: none;
  font-weight: 400;
}
.home-motion .hero h1 em {
  color: #ccd6e3;
  white-space: nowrap;
}
.home-motion .hero-bottom p {
  color: #e2eaf4;
  font-size: 14px;
  line-height: 1.8;
  margin: 28px 0 22px;
}
.hero-stage .hero-primary {
  display: inline-flex;
  justify-self: start;
  align-items: center;
  min-height: 50px;
  background: #dde6f2;
  color: #163c66;
  border: 1px solid #dde6f2;
  border-radius: 2px;
  font-size: 12px;
  font-weight: 600;
}
.hero-primary > span:first-child {
  padding: 0 23px;
}
.hero-primary-icon {
  display: grid;
  place-items: center;
  width: 50px;
  align-self: stretch;
  border-left: 1px solid #163c6630;
}
.hero-stage .hero-primary:hover {
  background: #bdcadc;
  border-color: #bdcadc;
}
.hero-primary:focus-visible {
  outline: 2px solid #dde6f2;
  outline-offset: 5px;
}
.hero-primary svg {
  transition: transform 220ms ease;
}
.hero-primary:hover svg,
.hero-primary:focus-visible svg {
  transform: scale(1.1);
}
.hero-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding-top: 20px;
  border-top: 1px solid #ffffff38;
}
.home-motion .hero-foot .hero-scroll {
  position: static;
  display: flex;
  align-items: center;
  gap: 14px;
  color: #dae4f1;
  font-size: 11px;
}
.hero-geography {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #cad5e3;
  font-size: 10px;
}
.home-motion #collection .shell {
  max-width: 1080px;
}
.home-motion #collection .section {
  padding-block: 48px;
}
.home-motion #collection :deep(.property-card.catalog-panel) {
  min-height: 460px;
}
.home-motion #collection :deep(.card-body) {
  padding: 22px;
}
.home-motion #collection :deep(.card-body h3) {
  font-size: 24px;
}
.home-motion .location-section {
  position: relative;
  isolation: isolate;
  clip-path: inset(0);
  display: grid;
  grid-template-rows: 1fr auto;
  min-height: max(640px, 86svh);
  margin: 0;
  padding: 96px 0 0;
  background: #1d416f;
  border: 0;
  border-radius: 0;
  color: #f2f6fb;
}
.location-backdrop,
.contact-backdrop {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
}
.location-backdrop {
  background:
    linear-gradient(90deg, #0c1b2ec9, #11264265 65%, #0c1b2e99),
    url("/images/backgrounds/home-location.webp") center / cover;
}
.coast-lead {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr);
  gap: 72px;
  align-items: end;
  align-self: center;
  padding-bottom: 88px;
}
.home-motion .coast-heading .eyebrow,
.home-motion .coast-fact .eyebrow {
  color: #bdcadb;
}
.home-motion .coast-heading h2 {
  margin-top: 24px;
  font-size: clamp(32px, 3.9vw, 56px);
  line-height: 1.08;
}
.home-motion .coast-heading h2 em {
  color: #ccd6e3;
}
.coast-intro {
  max-width: 360px;
  justify-self: end;
  padding-bottom: 6px;
}
.coast-intro > p {
  font-size: 14px;
  line-height: 1.9;
  color: #dfe8f3;
}
.location-link {
  display: flex;
  align-items: center;
  gap: 24px;
  width: fit-content;
  margin-top: 28px;
  padding-bottom: 10px;
  border-bottom: 1px solid #ffffff70;
  font-size: 12px;
}
.coast-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-top: 1px solid #ffffff30;
  padding: 30px 0 40px;
}
.coast-fact {
  padding-inline: 32px;
}
.coast-fact:first-child {
  padding-left: 0;
}
.coast-fact:last-child {
  padding-right: 0;
}
.coast-fact + .coast-fact {
  border-left: 1px solid #ffffff30;
}
.home-motion .coast-fact .eyebrow {
  font-size: 9px;
}
.coast-fact h3 {
  margin: 12px 0 10px;
  font-size: clamp(19px, 1.7vw, 25px);
  line-height: 1.3;
  letter-spacing: -0.03em;
  font-weight: 400;
}
.coast-fact > p:not(.eyebrow) {
  max-width: 340px;
  font-size: 12px;
  line-height: 1.8;
  color: #cedbed;
}
.home-motion .section-aside,
.home-motion .steps p {
  color: #466082;
}
.home-motion #process .section {
  padding-block: 48px;
}
.home-motion #process .section-heading {
  margin-bottom: 30px;
}
.home-motion #process h2 {
  font-size: clamp(30px, 3.2vw, 46px);
}
.home-motion .steps {
  gap: 0;
  margin-top: 0;
  border-top: 1px solid #bbc8da;
  padding-block: 28px;
}
.home-motion .steps > div {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 0 32px;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
.home-motion .steps > div:first-child {
  padding-left: 0;
}
.home-motion .steps > div:last-child {
  padding-right: 0;
}
.home-motion .steps > div + div {
  border-left: 1px solid #bbc8da;
}
.home-motion .steps > div > span {
  color: #6685ad;
  font-family: Georgia, serif;
  font-style: italic;
  font-size: 42px;
  line-height: 1;
  font-weight: 400;
}
.home-motion .steps h3 {
  font-weight: 500;
  margin: 18px 0 10px;
}
.home-motion .steps p {
  max-width: none;
}
.step-details {
  display: grid;
  gap: 9px;
  margin: 16px 0 22px;
  padding: 0;
  list-style: none;
}
.step-details li {
  display: flex;
  align-items: start;
  gap: 10px;
  font-size: 13px;
  line-height: 1.65;
  color: #3c526f;
}
.step-details svg {
  flex-shrink: 0;
  margin-top: 3px;
  color: #54749d;
}
.step-result {
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid #bbc8da;
}
.step-result small {
  font-size: 9px;
  letter-spacing: 0.14em;
  color: #54749d;
}
.home-motion .step-result p {
  font-size: 13px;
  line-height: 1.65;
  margin-top: 8px;
  color: #18355a;
}
.process-next {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  padding-top: 20px;
  border-top: 1px solid #bbc8da;
}
.process-next p {
  font-size: 17px;
  line-height: 1.8;
}
.process-next p span {
  color: #486285;
  font-size: 13px;
}
.process-next .text-link {
  flex-shrink: 0;
}
.home-motion .contact-section {
  position: relative;
  isolation: isolate;
  clip-path: inset(0);
  background: #1d416f;
  margin: 0;
  border: 0;
  border-radius: 0;
  padding: 85px 0;
}
.contact-backdrop {
  background:
    linear-gradient(90deg, #0d1c30c4, #12294650 65%, #12294635),
    url("/images/backgrounds/home-contact.webp") center / cover;
}
.home-motion .contact-story {
  justify-content: center;
  padding: 30px 0;
}
.home-motion .contact-story h2 {
  color: #e6ecf5;
}
.home-motion .contact-story h2 em {
  color: #a9bad1;
  text-decoration: none;
}
.home-motion .contact-story .eyebrow {
  color: #a9bad0;
}
.home-motion .contact-story-intro {
  color: #c3cfde;
}
.home-motion .contact-topics span {
  color: #d1dded;
}
.home-motion .contact-topics svg {
  color: #b1c1d5;
}
@media (max-width: 1100px) {
  .home-motion .shell {
    width: calc(100% - 64px);
  }
  .coast-lead {
    gap: 40px;
  }
  .coast-fact {
    padding-inline: 24px;
  }
  .home-motion .steps > div {
    padding-inline: 24px;
  }
}
@media (max-width: 800px) {
  .home-motion .shell {
    width: calc(100% - 40px);
  }
  .home-motion .hero {
    padding: 130px 0 24px;
    gap: 40px;
  }
  .home-motion .hero h1 {
    font-size: clamp(38px, 6.3vw, 54px);
  }
  .hero-backdrop {
    object-position: 60% center;
  }
  .home-motion .section {
    padding-block: 56px;
  }
  .home-motion .location-section {
    min-height: 0;
    padding-top: 64px;
  }
  .coast-lead {
    grid-template-columns: 1fr;
    gap: 28px;
    padding-bottom: 52px;
  }
  .home-motion .coast-heading h2 {
    font-size: clamp(30px, 5.8vw, 46px);
  }
  .coast-intro {
    max-width: 480px;
    justify-self: start;
  }
  .coast-facts {
    grid-template-columns: 1fr;
    padding: 4px 0 16px;
  }
  .coast-fact,
  .coast-fact:first-child,
  .coast-fact:last-child {
    padding: 22px 0;
  }
  .coast-fact + .coast-fact {
    border-left: 0;
    border-top: 1px solid #ffffff30;
  }
  .coast-fact h3 {
    margin: 8px 0;
    font-size: 22px;
  }
  .coast-fact > p:not(.eyebrow) {
    max-width: 480px;
  }
  .home-motion .steps {
    grid-template-columns: 1fr;
    padding-block: 0;
  }
  .home-motion .steps > div {
    padding: 28px 0;
  }
  .home-motion .steps > div + div {
    border-left: 0;
    border-top: 1px solid #bbc8da;
  }
  .home-motion .steps > div > span {
    font-size: 36px;
  }
  .process-next {
    align-items: start;
    flex-direction: column;
  }
  .home-motion .contact-section {
    padding-block: 55px;
  }
  .contact-backdrop {
    background-position:
      center,
      60% center;
  }
}
@media (max-width: 540px) {
  .home-motion .hero {
    padding-top: 124px;
    gap: 32px;
    padding-bottom: 20px;
  }
  .home-motion .hero h1 {
    --script-indent: 0.35em;
    --script-scale: 1.3;
    font-size: clamp(26px, 8vw, 42px);
    margin-top: 32px;
  }
  .hero-overlay {
    background:
      linear-gradient(90deg, #0c1a2dc9, #0d1d3155),
      linear-gradient(0deg, #0c1b2ee0, transparent 55%);
  }
  .home-motion .hero-bottom {
    display: block;
  }
  .home-motion .hero-bottom p {
    font-size: 12px;
    margin: 22px 0 16px;
  }
  .hero-geography {
    display: none;
  }
  .home-motion h2,
  .home-motion #process h2 {
    font-size: clamp(25px, 6.6vw, 34px);
  }
  .home-motion .coast-heading h2 {
    --script-scale: 1.05;
    font-size: clamp(26px, 6.8vw, 36px);
  }
  .coast-intro > p {
    font-size: 13px;
  }
}
@media (prefers-reduced-motion: no-preference) {
  .home-motion :deep(.card-image-link img) {
    transition: transform 700ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .home-motion .text-link,
  .home-motion .location-link {
    background-image: linear-gradient(currentColor, currentColor);
    background-position: left bottom;
    background-size: 0 2px;
    background-repeat: no-repeat;
    transition: background-size 300ms ease;
  }
  .home-motion .text-link:focus-visible,
  .home-motion .location-link:focus-visible {
    background-size: 100% 2px;
  }
  .home-motion .hero-scroll svg {
    animation: home-scroll-hint 1.6s ease-in-out 2;
  }
  @media (hover: hover) and (pointer: fine) {
    .home-motion :deep(.property-card:hover .card-image-link img) {
      transform: scale(1.035);
    }
    .home-motion .text-link:hover,
    .home-motion .location-link:hover {
      background-size: 100% 2px;
    }
  }
}
@media (prefers-reduced-motion: reduce) {
  .hero-primary svg {
    transition: none;
  }
}
@keyframes home-scroll-hint {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(5px);
  }
}
</style>
