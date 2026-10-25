<script setup lang="ts">
import Button from "~/components/ui/button/Button.vue";
import { Building2, ArrowRight } from "lucide-vue-next";
import "~/assets/css/admin.css";
definePageMeta({ layout: false });
const config = useRuntimeConfig();
useHead({
  title: () => "Вход — " + config.public.siteName,
  meta: [{ name: "robots", content: "noindex, nofollow" }],
});
const form = reactive({ email: "", password: "" });
const pending = ref(false),
  error = ref("");
async function login() {
  pending.value = true;
  error.value = "";
  try {
    await $fetch("/api/admin/login", { method: "POST", body: form });
    await navigateTo("/admin-console-9Xk6uiIs/properties");
  } catch (e: any) {
    error.value =
      e.status === 429
        ? "Слишком много попыток. Попробуйте через 10 минут."
        : "Проверьте email и пароль.";
  } finally {
    pending.value = false;
  }
}
</script>
<template>
  <div class="admin-login">
    <div class="login-panel">
      <NuxtLink to="/" class="admin-brand"
        ><span class="admin-brand-icon"
          ><Building2 :size="23" aria-hidden="true" /></span
        ><BrandName
      /></NuxtLink>
      <h1>Вход для менеджера</h1>
      <form @submit.prevent="login">
        <label
          >Email<input
            v-model="form.email"
            type="email"
            required
            autocomplete="username" /></label
        ><label
          >Пароль<input
            v-model="form.password"
            type="password"
            required
            autocomplete="current-password"
            maxlength="200"
        /></label>
        <p v-if="error" role="alert" class="error-text">{{ error }}</p>
        <Button type="submit" :disabled="pending"
          >{{ pending ? "Входим…" : "Войти"
          }}<ArrowRight :size="17" aria-hidden="true"
        /></Button>
      </form>
    </div>
  </div>
</template>
