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
  tour?: boolean;
}>();
const tourTypes = ["Калининград", "Побережье", "Пригород", "Индивидуальный"];
const tourType = ref(tourTypes[0]);
const commentLimit = computed(() => props.tour ? 1900 : 2000);
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
        comment: props.tour
          ? `Тур по новостройкам: ${tourType.value}.\n${form.comment}`.trim()
          : form.comment,
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
        <p class="lead-form-kicker">{{ tour ? "Тур по новостройкам" : "Личный подбор" }}</p>
        <h3>{{ tour ? "Заявка на тур" : "Квартира для вашей жизни" }}</h3>
      </div>
    </div>
    <p class="lead-form-intro">
      {{ tour
        ? "Выберите тур. Свяжемся с вами, чтобы обсудить пожелания, маршрут и удобное время."
        : "Подберём квартиру в Калининграде с учётом вашего бюджета, пожеланий к планировке и району." }}
    </p>
    <label v-if="tour" :for="uid + 'tour'">
      Выберите тур
      <AppSelect :id="uid + 'tour'" v-model="tourType" aria-label="Выберите тур">
        <AppSelectOption v-for="type in tourTypes" :key="type" :value="type">{{ type }}</AppSelectOption>
      </AppSelect>
    </label>
    <div class="lead-form-fields form-row">
      <label :for="uid + 'name'"
        >Ваше имя <span class="optional">необязательно</span><input
          :id="uid + 'name'"
          v-model="form.name"
          maxlength="100"
          placeholder="Как к вам обращаться"
          autocomplete="name" /></label
      ><label :for="uid + 'phone'"
        >Номер телефона <span class="required-hint" aria-hidden="true">обязательно</span><input
          :id="uid + 'phone'"
          v-model="form.phone"
          aria-label="Номер телефона"
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
        :maxlength="commentLimit"
        rows="2"
        :placeholder="tour
          ? 'Какие новостройки хотите посмотреть? Укажите удобное время и ориентир по бюджету.'
          : 'Какой район и планировка вам подходят? Укажите ориентир по бюджету.'"
      />
      <span class="comment-hint">{{ form.comment.length }} / {{ commentLimit }}</span>
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
      ><span>{{ pending ? "Отправляем…" : tour ? "Оставить заявку на тур" : "Обсудить подбор" }}</span
      ><ArrowUpRight :size="18" aria-hidden="true"
    /></Button>
    <p class="lead-form-note">
      <ShieldCheck :size="16" aria-hidden="true" />Контакты нужны только для
      ответа на вашу заявку
    </p>
  </form>
</template>

<style scoped>
.lead-form-fields {
  container-type: inline-size;
}
.required-hint {
  margin-left: 5px;
  color: #99616a;
  font-size: 0.7rem;
}
@media (min-width: 541px) {
  @container (max-width: 440px) {
    .lead-form-fields :is(.optional, .required-hint) {
      display: block;
      margin-left: 0;
      line-height: 20px;
    }
  }
}
</style>
