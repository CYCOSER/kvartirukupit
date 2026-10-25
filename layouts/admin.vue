<script setup lang="ts">
import {
  Building2,
  Inbox,
  BookOpen,
  ArrowUpRight,
  LogOut,
  LayoutDashboard,
} from "lucide-vue-next";
import "~/assets/css/admin.css";

const route = useRoute();
const sections = [
  {
    to: "/admin-console-9Xk6uiIs/properties",
    label: "ЖК и квартиры",
    icon: Building2,
  },
  { to: "/admin-console-9Xk6uiIs/leads", label: "Заявки", icon: Inbox },
  { to: "/admin-console-9Xk6uiIs/articles", label: "Блог", icon: BookOpen },
];
const sectionTitle = computed(
  () =>
    sections.find((section) => route.path.startsWith(section.to))?.label ||
    "Управление",
);
useHead({
  title: `Управление — ${useRuntimeConfig().public.siteName}`,
  meta: [{ name: "robots", content: "noindex, nofollow" }],
});
async function logout() {
  await $fetch("/api/admin/logout", { method: "POST" });
  await navigateTo("/admin-console-9Xk6uiIs/login");
}
</script>
<template>
  <div class="admin-shell admin-workspace">
    <a class="admin-skip" href="#admin-content">Перейти к содержимому</a>
    <aside class="admin-sidebar">
      <NuxtLink to="/" class="admin-brand"
        ><span class="admin-brand-icon"
          ><Building2 :size="23" aria-hidden="true" /></span
        ><BrandName
      /></NuxtLink>
      <nav aria-label="Управление" class="admin-navigation">
        <NuxtLink
          v-for="section in sections"
          :key="section.to"
          :to="section.to"
          :class="{ 'is-active': route.path.startsWith(section.to) }"
          :aria-current="route.path.startsWith(section.to) ? 'page' : undefined"
        >
          <component :is="section.icon" :size="19" aria-hidden="true" />{{
            section.label
          }}
        </NuxtLink>
      </nav>
    </aside>
    <div class="admin-content">
      <header class="admin-topbar">
        <div class="admin-breadcrumb">
          <LayoutDashboard :size="17" aria-hidden="true" /><span
            >Управление</span
          ><span aria-hidden="true">/</span><strong>{{ sectionTitle }}</strong>
        </div>
        <div class="admin-topbar-actions">
          <NuxtLink to="/" class="admin-site-link"
            >На сайт<ArrowUpRight :size="16" aria-hidden="true"
          /></NuxtLink>
          <button class="admin-logout" @click="logout">
            <LogOut :size="17" aria-hidden="true" />Выйти
          </button>
        </div>
      </header>
      <main id="admin-content" class="admin-main" tabindex="-1"><slot /></main>
    </div>
  </div>
</template>
