<script setup lang="ts">
import {
  ArrowUpRight,
  Check,
  MessageCircle,
  ShieldCheck,
} from "lucide-vue-next";
import Button from "~/components/ui/button/Button.vue";
const props = defineProps<{
  propertyId?: string;
}>();
const form = reactive({
  name: "",
  phone: "",
  comment: "",
  consent: false,
  website: "",
});
const pending = ref(false),
  success = ref(false),
  error = ref("");
const uid = useId();
const commentField = useAutoResizeTextarea(() => form.comment);
async function submit() {
  pending.value = true;
  error.value = "";
  try {
    await $fetch("/api/leads", {
      method: "POST",
      body: {
        ...form,
        propertyId: props.propertyId,
        purpose: "buyer",
      },
    });
    success.value = true;
  } catch (e: any) {
    error.value =
      e.status === 429
        ? "Слишком много попыток. Пожалуйста, попробуйте через 10 минут."
        : "Не удалось отправить заявку. Проверьте данные и попробуйте ещё раз.";
  } finally {
    pending.value = false;
  }
}
</script>
<template>
  <div v-if="success" role="status" class="form-success">
    <span><Check /></span>
    <h3>Заявка принята</h3>
    <p>
      {{
        "Спасибо. Свяжемся с вами, чтобы уточнить пожелания и обсудить дальнейшие шаги."
      }}
    </p>
  </div>
  <form
    v-else
    class="lead-form"
    @submit.prevent="submit"
  >
    <div class="lead-form-heading">
      <span class="lead-form-icon"
        ><MessageCircle :size="22" aria-hidden="true"
      /></span>
      <div>
        <p class="lead-form-kicker">Личный подбор</p>
        <h3>Квартира для вашей жизни</h3>
      </div>
    </div>
    <p class="lead-form-intro">
      Подберём квартиру в Калининграде с учётом вашего бюджета, пожеланий к планировке и району.
    </p>
    <div class="lead-form-fields form-row">
      <label :for="uid + 'name'"
        >Ваше имя <span class="optional">необязательно</span><input
          :id="uid + 'name'"
          v-model="form.name"
          maxlength="100"
          placeholder="Как к вам обращаться"
          autocomplete="name" /></label
      ><label :for="uid + 'phone'"
        >Номер телефона<input
          :id="uid + 'phone'"
          v-model="form.phone"
          required
          type="tel"
          minlength="10"
          maxlength="25"
          placeholder="+7 (___) ___-__-__"
          autocomplete="tel"
      /></label>
    </div>
    <label :for="uid + 'comment'"
      >Комментарий <span class="optional">необязательно</span
      ><textarea
        ref="commentField"
        :id="uid + 'comment'"
        v-model="form.comment"
        maxlength="2000"
        rows="2"
        placeholder="Какой район и планировка вам подходят? Укажите ориентир по бюджету."
      />
      <span class="comment-hint">{{ form.comment.length }} / 2000</span>
    </label>
    <div class="honeypot" aria-hidden="true">
      <label
        >Website<input v-model="form.website" tabindex="-1" autocomplete="off"
      /></label>
    </div>
    <label class="consent"
      ><input v-model="form.consent" type="checkbox" required /><span
        >Даю согласие на обработку имени, телефона и сведений из заявки для
        ответа на моё обращение.
        <NuxtLink to="/privacy">Политика конфиденциальности</NuxtLink></span
      ></label
    >
    <p v-if="error" role="alert" class="error-text">{{ error }}</p>
    <Button type="submit" :disabled="pending"
      ><span>{{ pending ? "Отправляем…" : "Обсудить подбор" }}</span
      ><ArrowUpRight :size="18" aria-hidden="true"
    /></Button>
    <p class="lead-form-note">
      <ShieldCheck :size="16" aria-hidden="true" />Контакты нужны только для
      ответа на вашу заявку
    </p>
  </form>
</template>
