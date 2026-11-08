<script setup lang="ts">
import { Calculator } from "lucide-vue-next";
import { calculateMortgage, mortgageDefaults } from "~/shared/mortgage";
import { money } from "~/shared/property";
const props = defineProps<{ price: number | null }>();
const uid = useId();
const cost = ref<number | string>(props.price ?? "");
const deposit = ref<number | string>(mortgageDefaults.depositPercent);
const years = ref<number | string>(mortgageDefaults.years);
const rate = ref<number | string>(mortgageDefaults.rate);
watch(
  () => props.price,
  (value) => {
    cost.value = value ?? "";
  },
);
const result = computed(() =>
  [cost.value, deposit.value, years.value, rate.value].some((v) => v === "")
    ? null
    : calculateMortgage(
        Number(cost.value),
        Number(deposit.value),
        Number(years.value),
        Number(rate.value),
      ),
);
const roundedMoney = (value: number) => money(Math.round(value));
</script>

<template>
  <section id="mortgage" class="mortgage" :aria-labelledby="uid + '-title'">
    <div class="mortgage-heading">
      <span class="mortgage-icon"
        ><Calculator :size="24" aria-hidden="true"
      /></span>
      <div>
        <p class="eyebrow">ПЛАНИРУЕМ ПОКУПКУ</p>
        <h2 :id="uid + '-title'">Калькулятор ипотеки</h2>
      </div>
    </div>
    <div class="mortgage-grid">
      <div class="mortgage-fields">
        <label :for="uid + '-cost'"
          >Стоимость квартиры, ₽<NumberField
            :id="uid + '-cost'"
            v-model="cost"
            :increment="300000"
            :min="1"
            :max="2000000000"
            control-label="стоимость квартиры"
            placeholder="Укажите стоимость"
        /></label>
        <div>
          <label :for="uid + '-deposit'"
            >Первоначальный взнос, %<NumberField
              :id="uid + '-deposit'"
              v-model="deposit"
              :increment="1"
              :min="0"
              :max="100"
              control-label="первоначальный взнос"
          /></label>
          <div class="mortgage-presets">
            <button
              v-for="value in [20, 30, 50]"
              :key="value"
              type="button"
              :aria-pressed="Number(deposit) === value"
              @click="deposit = value"
            >
              {{ value }}%
            </button>
          </div>
        </div>
        <div class="mortgage-pair">
          <label :for="uid + '-years'"
            >Срок, лет<NumberField
              :id="uid + '-years'"
              v-model="years"
              :increment="1"
              :min="1"
              :max="30"
              control-label="срок кредита" /></label
          ><label :for="uid + '-rate'"
            >Ставка, % годовых<NumberField
              :id="uid + '-rate'"
              v-model="rate"
              :increment="0.1"
              :min="0"
              :max="50"
              control-label="процентную ставку"
          /></label>
        </div>
      </div>
      <div class="mortgage-result" aria-live="polite" aria-atomic="true">
        <p>Ежемесячный платёж</p>
        <strong class="mortgage-payment">{{
          roundedMoney(result?.monthly ?? 0)
        }}</strong>
        <span class="mortgage-caption">{{
          result ? "равными платежами каждый месяц" : "Расчёт ещё не выполнен"
        }}</span>
        <dl>
          <div>
            <dt>Первый взнос</dt>
            <dd>{{ roundedMoney(result?.deposit ?? 0) }}</dd>
          </div>
          <div>
            <dt>Сумма кредита</dt>
            <dd>{{ roundedMoney(result?.principal ?? 0) }}</dd>
          </div>
          <div>
            <dt>Проценты за весь срок</dt>
            <dd>{{ roundedMoney(result?.interest ?? 0) }}</dd>
          </div>
          <div>
            <dt>Всего выплат по кредиту</dt>
            <dd>{{ roundedMoney(result?.total ?? 0) }}</dd>
          </div>
        </dl>
        <p v-if="result?.principal === 0">
          При взносе 100% кредит не требуется.
        </p>
      </div>
    </div>
    <p class="mortgage-disclaimer">
      Ипотечные кредиты предоставляются банками-партнёрами. Мы не выступаем кредиторами.
      Расчёт предварительный и не является предложением банка.
      Страхование, комиссии и другие расходы не учтены. Итоговый платёж,
      ставку и условия кредита определяет банк.
    </p>
  </section>
</template>

<style scoped>
.mortgage {
  margin: 40px 0;
  padding: clamp(20px, 3vw, 32px);
  border: 1px solid #c4d0e0;
  border-radius: 0;
  background: #fff;
}
.mortgage-heading {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 14px;
  align-items: stretch;
}
.mortgage-heading > div {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 0;
  padding: 2px 0;
  min-width: 0;
}
.mortgage-heading .eyebrow {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.35;
}
.mortgage-icon {
  display: grid;
  place-items: center;
  flex: 0 0 48px;
  min-height: 48px;
  border-radius: 0;
  color: #476184;
  background: #d9e3f0;
}
.mortgage h2 {
  font-size: 1.25rem;
  margin: 0;
  line-height: 1.2;
  letter-spacing: -0.03em;
}
.mortgage-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 24px;
  margin-top: 26px;
}
.mortgage-fields {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
  justify-content: space-between;
}
.mortgage label {
  font-weight: 500;
}
.mortgage :deep(.number-field) {
  margin-top: 8px;
}
.mortgage-pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}
.mortgage-presets {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.mortgage-presets button {
  border: 1px solid #b6c4d7;
  border-radius: 7px;
  padding: 6px 12px;
  font-size: 0.75rem;
}
.mortgage-presets button[aria-pressed="true"] {
  color: #476184;
  background: #d9e3f0;
  border-color: #476184;
}
.mortgage-result {
  min-width: 0;
  background: #102f50;
  color: #fff;
  border-radius: 0;
  padding: 24px;
  font-size: 0.875rem;
  line-height: 1.6;
}
.mortgage-payment {
  display: block;
  font-size: clamp(1.6rem, 2.6vw, 2.5rem);
  line-height: 1.3;
  margin: 12px 0 8px;
  color: #ccd6e3;
}
.mortgage-caption {
  font-size: 0.75rem;
  color: #c4d0df;
}
.mortgage dl {
  border-top: 1px solid #ffffff30;
  margin-top: 22px;
  padding-top: 8px;
}
.mortgage dl > div {
  margin-top: 14px;
}
.mortgage dt {
  color: #c4d0df;
  font-size: 0.75rem;
}
.mortgage dd {
  font-weight: 600;
}
.mortgage-disclaimer {
  font-size: 0.75rem;
  line-height: 1.8;
  color: #486285;
  margin-top: 18px;
}
@media (max-width: 1100px) {
  .mortgage-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 540px) {
  .mortgage-pair {
    grid-template-columns: 1fr;
  }
  .mortgage-result {
    padding: 20px;
  }
}
</style>
