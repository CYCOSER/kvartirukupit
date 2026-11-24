<script setup lang="ts">
import { BookOpen, Building2, Compass, House, Landmark, MapPin, Menu, MessageCircle, Phone } from "lucide-vue-next";
import Sheet from "~/components/ui/sheet/Sheet.vue";
import { useAnalyticsConsent } from "~/composables/useAnalyticsConsent";
const config = useRuntimeConfig();

useHead({
  script: [
    {
      type: "application/ld+json",
      innerHTML: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Organization",
        name: config.public.siteName,
        url: config.public.siteUrl,
        logo: config.public.siteLogo,
        address: {
          "@type": "PostalAddress",
          addressLocality: "Калининград, пр-т Ленинский, 30 (ТЦ Плаза)",
          addressCountry: "RU",
        }
      }).replace(/</g, "\\u003c"),
    },
  ],
});

const { openSettings: openCookieSettings } = useAnalyticsConsent();
const menu = ref(false);
const route = useRoute();
const menuLinks = [
  { to: '/catalog', label: 'Новостройки', description: 'Квартиры в новых домах', icon: Building2, primary: true },
  { to: '/elite', label: 'Готовые квартиры', description: 'Для жизни здесь и сейчас', icon: House, primary: true },
  { to: '/tours', label: 'Туры по новостройкам', shortLabel: 'Туры', description: 'По новостройкам', icon: Compass },
  { to: '/ipoteka', label: 'Ипотека', description: 'Спланировать покупку', icon: Landmark },
  { to: '/blog', label: 'Блог', description: 'О городе и выборе дома', icon: BookOpen },
  { to: '/#contact', label: 'Контакты', description: 'Будем на связи', icon: MessageCircle },
];
function isMenuLinkActive(to: string) {
  return to === '/#contact'
    ? route.path === '/' && route.hash === '#contact'
    : route.path === to || route.path.startsWith(to + '/');
}
const headerHidden = ref(false);
let previousScroll = 0;
function updateHeader() {
  const top = Math.max(0, window.scrollY);
  if (top <= 82 || menu.value) {
    headerHidden.value = false;
  } else if (Math.abs(top - previousScroll) < 6) {
    return;
  } else {
    headerHidden.value = top > previousScroll;
  }
  previousScroll = top;
}
watch(menu, (isOpen) => {
  if (isOpen) headerHidden.value = false;
});
watch(
  () => route.fullPath,
  () => {
    headerHidden.value = false;
  },
);
onMounted(() => {
  previousScroll = Math.max(0, window.scrollY);
  window.addEventListener("scroll", updateHeader, { passive: true });
});
onBeforeUnmount(() => window.removeEventListener("scroll", updateHeader));
</script>
<template>
  <div
    class="glass-home-layout"
    :class="{
      'glass-inner-layout': route.path !== '/',
      'glass-photo-layout':
        /^\/(elite|catalog|blog|privacy|ipoteka|tours)(\/|$)/.test(route.path),
    }"
  >
    <a href="#main" class="skip-link">Перейти к содержимому</a>
    <header class="site-header" :class="{ 'is-hidden': headerHidden }">
      <div class="shell header-inner">
        <NuxtLink
          to="/"
          class="brand"
          :aria-label="config.public.siteName + ' — главная'"
          ><BrandMark class="brand-mark" /><span class="brand-lockup"
            ><BrandName /><span class="brand-caption"
              >Новостройки · Калининград</span
            ></span
          ></NuxtLink
        >
        <nav class="desktop-nav" aria-label="Основная навигация">
          <NuxtLink to="/catalog">Новостройки</NuxtLink
          ><NuxtLink to="/elite">Готовые квартиры</NuxtLink
          ><NuxtLink to="/tours">Туры</NuxtLink
          ><NuxtLink to="/ipoteka">Ипотека</NuxtLink
          ><NuxtLink to="/blog">Блог</NuxtLink
          ><NuxtLink to="/#contact">Контакты</NuxtLink>
        </nav>
        <NuxtLink to="/catalog" class="header-catalog">Новостройки</NuxtLink>
        <a
          v-if="config.public.phone"
          :href="'tel:' + config.public.phone.replace(/[^+\d]/g, '')"
          class="header-phone"
          >{{ config.public.phone }}</a
        ><NuxtLink to="/#contact" class="header-contact"
          >Связаться <MessageCircle :size="17" :stroke-width="1.5" aria-hidden="true" /></NuxtLink
        ><Sheet
          v-model:open="menu"
          :title="config.public.siteName"
          description="Квартиры в Калининграде"
          navigation
          ><template #trigger
            ><button class="mobile-menu" aria-label="Открыть меню">
              <Menu /></button
          ></template>
          <template #title
            ><span class="brand menu-brand"
              ><BrandMark class="brand-mark" /><BrandName /></span
          ></template>
          <div class="menu-content">
            <nav
              class="menu-navigation"
              aria-label="Меню сайта"
              @click="menu = false"
            >
              <NuxtLink
                v-for="link in menuLinks"
                :key="link.to"
                :to="link.to"
                :aria-label="link.label"
                :aria-describedby="link.description ? 'menu-description-' + link.to.slice(1) : undefined"
                :class="{ 'menu-property-link': link.primary, 'is-current': isMenuLinkActive(link.to) }"
                :aria-current="isMenuLinkActive(link.to) ? 'page' : 'false'"
              ><span class="menu-link-icon" aria-hidden="true"><component :is="link.icon" :size="link.primary ? 25 : 22" :stroke-width="1.4" /></span><span class="menu-link-copy"><span>{{ link.shortLabel || link.label }}</span><small :id="'menu-description-' + link.to.slice(1)">{{ link.description }}</small></span></NuxtLink>
            </nav>
            <div class="menu-contact">
              <p class="menu-label">
                <MapPin :size="14" aria-hidden="true" />Калининград
              </p>
              <NuxtLink
                to="/#contact"
                class="menu-contact-link"
                @click="menu = false"
                ><MessageCircle :size="19" aria-hidden="true" /><span>Личный подбор квартиры</span></NuxtLink>
              <a
                v-if="config.public.phone"
                :href="'tel:' + config.public.phone.replace(/[^+\d]/g, '')"
                class="menu-phone"
                ><Phone :size="15" aria-hidden="true" />{{
                  config.public.phone
                }}</a
              >
            </div>
          </div></Sheet
        >
      </div>
    </header>
    <main id="main" :class="{ 'inner-page-motion': route.path !== '/' }">
      <slot />
    </main>
    <footer class="site-footer">
      <div class="shell">
        <div class="footer-top">
          <div class="footer-brand-group">
            <NuxtLink to="/" class="brand"
              ><BrandMark class="brand-mark" /><BrandName
            /></NuxtLink>
            <p class="type-pair">
              <span class="type-upright">Ваше пространство</span><em class="type-script footer-script">Ваш Калининград</em>
            </p>
          </div>
          <div class="footer-navigation">
            <nav class="footer-destinations" aria-label="Разделы сайта">
              <NuxtLink to="/catalog"
                ><span
                  ><small>ДЛЯ ПОКУПАТЕЛЕЙ</small>Найти свою квартиру</span
                ></NuxtLink
              >

              <NuxtLink to="/tours"
                ><span><small>СМОТРИМ ВЖИВУЮ</small>Туры по новостройкам</span></NuxtLink
              >
              <NuxtLink to="/ipoteka"
                ><span><small>ПЛАНИРУЕМ ПОКУПКУ</small>Ипотека</span></NuxtLink
              >
              <NuxtLink to="/blog"
                ><span><small>ИНТЕРЕСНОЕ</small>Блог</span></NuxtLink
              >
            </nav>
          </div>
        </div>
        <div class="footer-bottom">
          <span
            >© {{ new Date().getFullYear() }} {{ config.public.siteName }}</span
          ><NuxtLink to="/privacy">Конфиденциальность</NuxtLink
          ><button class="cookie-settings-link" type="button" @click="openCookieSettings"
            >Настройки cookie</button
          ><span>Калининград</span>
        </div>
      </div>
    </footer>
  </div>
</template>
<style scoped>
.glass-home-layout .site-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  color: #fff;
  background: rgba(16, 47, 80, 0.86);
  border: 0;
  border-bottom: 1px solid #ffffff38;
  border-radius: 0;
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
  box-shadow: none;
}
.glass-home-layout .site-header.is-hidden:not(:has(:focus-visible)) {
  transform: translateY(-100%);
  pointer-events: none;
}
@media (prefers-reduced-motion: no-preference) {
  .glass-home-layout .site-header {
    transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
  }
}
.glass-home-layout .header-inner {
  min-height: 82px;
  width: min(1320px, calc(100% - 96px));
}
.glass-home-layout .brand {
  font-size: 1.25rem;
}
.brand-lockup {
  display: grid;
  gap: 1px;
  text-align: center;
}
.brand-caption {
  color: #bdcadc;
  font-size: 10px;
  font-weight: 400;
  line-height: 1.2;
  letter-spacing: 0.04em;
}
.glass-home-layout .brand-mark,
.glass-home-layout :deep(.brand-dash) {
  color: #bdcadc;
}
.glass-home-layout .site-header .brand-mark,
.glass-photo-layout .site-header .brand-mark {
  --brand-accent: #7aa7ed;
}
.glass-home-layout .desktop-nav {
  font-size: 11px;
  gap: 20px;
  margin-left: auto;
}
.desktop-nav,
.header-catalog,
.header-contact {
  font-family: var(--font-body);
  font-weight: 500;
  letter-spacing: 0;
  text-transform: uppercase;
  white-space: nowrap;
}
.desktop-nav a,
.header-catalog {
  position: relative;
  padding: 10px 0;
}
.desktop-nav a::after,
.header-catalog::after {
  content: "";
  position: absolute;
  bottom: 2px;
  left: 0;
  width: 100%;
  height: 1px;
  background: currentColor;
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 220ms ease;
}
.desktop-nav a:hover::after,
.desktop-nav a:focus-visible::after,
.header-catalog:hover::after,
.header-catalog:focus-visible::after,
.desktop-nav a.router-link-active:not([href*="#"])::after {
  transform: scaleX(1);
}
.glass-home-layout .desktop-nav a:hover,
.glass-home-layout .header-catalog:hover {
  color: #c4d0df;
}
.glass-home-layout .header-contact {
  border: 0;
  border-left: 1px solid #ffffff38;
  background: transparent;
  border-radius: 0;
  color: inherit;
  font-size: 11px;
  padding: 10px 12px 10px 24px;
  margin-right: -12px;
}
.glass-home-layout .header-contact:hover,
.glass-home-layout .header-contact:focus-visible {
  color: #163c66;
  background: #bdcadc;
}
.glass-home-layout .header-contact:focus-visible {
  outline: 2px solid #bdcadc;
  outline-offset: 4px;
}
@media (prefers-reduced-motion: no-preference) {
  .header-contact {
    transition:
      color 200ms ease,
      background-color 200ms ease;
  }
  .header-contact svg {
    transition: transform 200ms ease;
  }
  .header-contact:hover svg,
  .header-contact:focus-visible svg {
    transform: translateY(-1px);
  }
}
.glass-home-layout .mobile-menu {
  color: white;
}
.header-catalog {
  display: none;
  flex-shrink: 0;
  padding: 8px 0;
  font-size: 12px;
  color: inherit;
}
@media (max-width: 1100px) {
  .glass-home-layout .header-inner {
    width: calc(100% - 64px);
  }
  .header-catalog {
    display: inline-block;
    margin-left: auto;
  }
}
.glass-home-layout .site-footer {
  padding: 76px 0 28px;
  background: #dbe4f1;
  color: #18355a;
  border-top: 1px solid #b8c6d9;
}
.glass-home-layout .footer-top {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.65fr);
  gap: 64px;
  padding-bottom: 64px;
}
.glass-home-layout .footer-brand-group,
.glass-home-layout .footer-navigation {
  grid-column: auto;
}
.glass-home-layout .footer-brand-group > p {
  --script-indent: 0;
  --script-color: #18355a;
  --script-overlap: 0.1em;
  margin-top: 26px;
  color: #18355a;
  font-size: clamp(1.7rem, 2.5vw, 2.5rem);
  line-height: 1.18;
  letter-spacing: -0.05em;
}
.glass-home-layout .footer-brand-group .type-upright {
  font-family: var(--font-body);
  letter-spacing: -0.05em;
  text-transform: none;
}
.glass-home-layout .site-footer .brand {
  color: #3e5574;
}
.glass-home-layout .site-footer .brand-mark,
.glass-home-layout .site-footer :deep(.brand-dash) {
  color: #54739b;
}
.glass-home-layout .footer-destinations {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
}
.glass-home-layout .footer-destinations a {
  min-width: 0;
  align-items: flex-start;
  padding: 4px 24px 28px;
  color: #18355a;
  background: transparent;
  border: 0;
  border-left: 1px solid #b0c0d4;
  border-radius: 0;
  box-shadow: none;
  font-size: 1.2rem;
  line-height: 1.3;
  overflow-wrap: normal;
}
.glass-home-layout .footer-destinations a:last-child {
  padding-right: 0;
}
.glass-home-layout .footer-destinations small {
  margin-bottom: 24px;
  color: #4b668a;
  font-size: 9px;
  letter-spacing: 0.1em;
  line-height: 1.5;
}
.glass-home-layout .footer-destinations a:hover,
.glass-home-layout .footer-destinations a:focus-visible {
  color: #476184;
  background: transparent;
  border-color: #7c96b8;
}
.glass-home-layout .footer-destinations a:focus-visible {
  outline-color: #476184;
  outline-offset: 5px;
}
.glass-home-layout .footer-bottom {
  color: #3e5574;
}
.glass-home-layout .footer-bottom {
  border-color: #b8c6d9;
}
.glass-home-layout .footer-bottom a:hover,
.glass-home-layout .footer-bottom a:focus-visible {
  text-decoration: underline;
  text-underline-offset: 4px;
}
.cookie-settings-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.cookie-settings-link:hover,
.cookie-settings-link:focus-visible {
  text-decoration: underline;
  text-underline-offset: 4px;
}
@media (max-width: 1400px) {
  .glass-home-layout .footer-top {
    grid-template-columns: 1fr;
    gap: 32px;
    padding-bottom: 42px;
  }
  .glass-home-layout .footer-brand-group {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
  }
  .glass-home-layout .footer-brand-group > p {
    margin-top: 0;
  }
  .glass-home-layout .footer-destinations a {
    padding-inline: 18px;
  }
  .glass-home-layout .footer-destinations a:first-child {
    border-left: 0;
    padding-left: 0;
  }
}
@media (max-width: 800px) {
  .glass-home-layout .footer-destinations {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    row-gap: 28px;
  }
  .glass-home-layout .footer-destinations a:nth-child(odd) {
    border-left: 0;
    padding-left: 0;
  }
}
@media (max-width: 540px) {
  .glass-home-layout .footer-brand-group {
    display: block;
  }
  .glass-home-layout .footer-brand-group > p {
    margin-top: 22px;
  }
  .glass-home-layout .footer-destinations {
    grid-template-columns: 1fr;
    row-gap: 0;
  }
  .glass-home-layout .site-footer {
    padding-top: 46px;
  }
  .glass-home-layout .footer-destinations a,
  .glass-home-layout .footer-destinations a:first-child {
    align-items: center;
    padding: 22px 0;
    border: 0;
    border-top: 1px solid #b0c0d4;
  }
  .glass-home-layout .footer-destinations small {
    margin-bottom: 8px;
  }
}
.glass-inner-layout {
  background:
    radial-gradient(ellipse at 0% 30%, #d0dded, transparent 55%),
    radial-gradient(ellipse at 100% 65%, #c8d7ea, transparent 50%), #eaf0f7;
  padding-top: 0;
}
.glass-inner-layout .site-header {
  margin: 0;
  color: #102f50;
  background: rgba(242, 246, 251, 0.9);
  border-color: #b6c4d7;
}
.glass-inner-layout:not(.glass-photo-layout) {
  padding-top: 82px;
}
.glass-inner-layout .brand-mark,
.glass-inner-layout :deep(.brand-dash),
.glass-inner-layout .mobile-menu {
  color: #476184;
}
.glass-inner-layout .desktop-nav a:hover,
.glass-inner-layout .header-catalog:hover,
.glass-inner-layout .desktop-nav a.router-link-active {
  color: #476184;
}
.glass-inner-layout .header-contact {
  color: #245fbd;
  border-color: #b6c4d7;
}
.glass-photo-layout {
  padding-top: 0;
}
.glass-photo-layout .site-header {
  margin: 0;
  color: #fff;
  background: rgba(16, 47, 80, 0.86);
  border-color: #ffffff38;
}
.glass-photo-layout .brand-mark,
.glass-photo-layout :deep(.brand-dash),
.glass-photo-layout .mobile-menu {
  color: #bdcadc;
}
.glass-photo-layout .desktop-nav a:hover,
.glass-photo-layout .header-catalog:hover,
.glass-photo-layout .desktop-nav a.router-link-active {
  color: #ccd6e3;
}
.glass-photo-layout .header-contact {
  color: #fff;
  border-color: #ffffff38;
}
@media (max-width: 800px) {
  .glass-inner-layout:not(.glass-photo-layout) {
    padding-top: 74px;
  }
  .glass-home-layout .header-inner {
    width: calc(100% - 40px);
    min-height: 74px;
    gap: 12px;
  }
}
@media (max-width: 540px) {
  .glass-home-layout .header-inner {
    gap: 8px;
    flex-wrap: nowrap;
  }
  .header-catalog {
    padding: 8px 0;
    font-size: 11px;
  }
  .glass-home-layout .mobile-menu {
    padding: 6px;
  }
  .glass-home-layout .brand {
    font-size: 0.95rem;
    gap: 7px;
  }
  .glass-home-layout .brand-mark {
    width: 30px;
    height: 30px;
  }
  .brand-caption {
    font-size: 9px;
    letter-spacing: 0.02em;
  }
}
.menu-brand {
  font-size: 1.1rem;
  gap: 10px;
}
.menu-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 28px;
}
.menu-navigation {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.menu-navigation a {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 16px;
  min-width: 0;
  padding: 18px 16px;
  border: 1px solid #b8cbdf80;
  border-radius: 14px;
  background: #ffffff40;
  font-family: var(--font-brand);
  font-size: clamp(0.8125rem, 3.6vw, 1rem);
  letter-spacing: 0;
  line-height: 1.3;
  text-transform: uppercase;
}
.menu-navigation .menu-property-link {
  grid-column: 1 / -1;
  flex-direction: row;
  align-items: center;
  padding: 20px 18px;
  gap: 16px;
  font-size: clamp(1rem, 4.3vw, 1.25rem);
  background: linear-gradient(110deg, #ffffffd9, #ffffff59);
}
.menu-link-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  color: #406b9a;
}
.menu-property-link .menu-link-icon {
  width: 44px;
  height: 44px;
  border: 1px solid #c5d7e8;
  border-radius: 13px;
  background: linear-gradient(135deg, #edf5ff, #dce8f5);
}
.menu-link-copy {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.menu-navigation small {
  color: #617b9a;
  font: 0.75rem/1.5 var(--font-body);
  text-transform: none;
}
.menu-navigation svg {
  flex-shrink: 0;
  color: #486387;
}
.menu-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  color: #445d7d;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.menu-contact {
  margin-top: auto;
  padding: 20px;
  border: 1px solid #b8cbdf80;
  border-radius: 16px;
  background: linear-gradient(135deg, #ffffffb3, #edf4fccc);
}
.menu-contact-link {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 10px;
  background: #23476e;
  color: #fff;
  font-family: var(--font-body);
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.5;
}
.menu-contact-link svg {
  flex-shrink: 0;
}
.menu-phone {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 18px;
  font-size: 14px;
}
.menu-navigation a:hover,
.menu-navigation a:focus-visible,
.menu-navigation a.is-current {
  border-color: #b6cbe3;
  background: #ffffffd9;
  color: #245f9b;
}
.menu-contact-link:hover,
.menu-contact-link:focus-visible {
  background: #364963;
}
.menu-navigation a:focus-visible,
.menu-contact-link:focus-visible {
  outline-offset: -3px;
}
@media (prefers-reduced-motion: no-preference) {
  .menu-navigation a,
  .menu-contact-link {
    transition: background-color 180ms ease, border-color 180ms ease, color 180ms ease;
  }
}
</style>
