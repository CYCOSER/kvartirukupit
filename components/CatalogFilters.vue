<script setup lang="ts">
import { types, statuses } from "~/shared/property";
defineProps<{ locations: string[]; apartmentsOnly?: boolean }>();
const model = defineModel<Record<string, string>>({ required: true });
defineEmits(["apply", "reset"]);
const uid = useId();
</script>
<template>
  <form class="catalog-filters" @submit.prevent="$emit('apply')">
    <label v-if="!apartmentsOnly" :for="uid + 'type'"
      >Тип недвижимости<AppSelect :id="uid + 'type'" v-model="model.type">
        <AppSelectOption
          v-for="(label, value) in types"
          :key="value"
          :value="value"
        >
          {{ label }}
        </AppSelectOption>
      </AppSelect></label
    ><label :for="uid + 'location'"
      >Город или район<AppSelect :id="uid + 'location'" v-model="model.location">
        <AppSelectOption value="">Все города и районы</AppSelectOption>
        <AppSelectOption
          v-for="location in locations"
          :key="location"
          :value="location"
        >
          {{ location }}
        </AppSelectOption>
      </AppSelect></label
    >
    <fieldset>
      <legend class="mb-2 text-sm font-semibold">Цена, ₽</legend>
      <div class="filter-pair">
        <NumberField
          v-model="model.minPrice"
          aria-label="Цена от"
          min="0"
          placeholder="От"
          :increment="300000"
          control-label="цену от"
        /><NumberField
          v-model="model.maxPrice"
          aria-label="Цена до"
          min="0"
          placeholder="До"
          :increment="300000"
          control-label="цену до"
        />
      </div>
    </fieldset>
    <fieldset>
      <legend class="mb-2 text-sm font-semibold">Площадь квартиры, м²</legend>
      <div class="filter-pair">
        <NumberField
          v-model="model.minArea"
          aria-label="Площадь от"
          min="0"
          placeholder="От"
          :increment="10"
          control-label="площадь от"
        /><NumberField
          v-model="model.maxArea"
          aria-label="Площадь до"
          min="0"
          placeholder="До"
          :increment="10"
          control-label="площадь до"
        />
      </div>
    </fieldset>
    <label :for="uid + 'bedrooms'"
      >Комнаты<AppSelect :id="uid + 'bedrooms'" v-model="model.bedrooms">
        <AppSelectOption value="">Любое количество</AppSelectOption>
        <AppSelectOption v-for="n in 5" :key="n" :value="String(n)">
          {{ n }} и более
        </AppSelectOption>
      </AppSelect></label
    ><label :for="uid + 'status'"
      >Статус<AppSelect :id="uid + 'status'" v-model="model.status">
        <AppSelectOption
          v-for="(label, value) in statuses"
          :key="value"
          :value="value"
        >
          {{ label }}
        </AppSelectOption>
        <AppSelectOption value="all">Любой статус</AppSelectOption>
      </AppSelect></label
    ><button
      type="submit"
      class="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white"
    >
      Показать объекты</button
    ><button
      type="button"
      class="text-sm text-slate-500 underline"
      @click="$emit('reset')"
    >
      Сбросить фильтры
    </button>
  </form>
</template>
