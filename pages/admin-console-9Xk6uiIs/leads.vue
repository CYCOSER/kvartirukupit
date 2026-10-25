<script setup lang="ts">
import { leadStatuses } from "~/shared/property";
definePageMeta({ middleware: "admin", layout: "admin" });
type Lead = {
  id: string;
  name: string;
  phone: string;
  comment: string;
  createdAt: string;
  status: keyof typeof leadStatuses;
  property: { title: string } | null;
};
const { data, refresh, error } = await useFetch<Lead[]>("/api/admin/leads");
const status = ref("");
const notice = ref("");
const filtered = computed(
  () =>
    data.value?.filter((l) => !status.value || l.status === status.value) || [],
);
async function change(id: string, value: string) {
  try {
    await $fetch("/api/admin/leads/" + id, {
      method: "PATCH",
      body: { status: value },
    });
    await refresh();
    notice.value = "Статус заявки обновлён.";
  } catch {
    notice.value = "Не удалось изменить статус.";
    await refresh();
  }
}
</script>
<template>
  <div>
    <h1 class="admin-title">Заявки покупателей квартир</h1>
    <AppSelect v-model="status" aria-label="Фильтр заявок" class="mb-6 !w-auto">
      <AppSelectOption value="">Все заявки</AppSelectOption>
      <AppSelectOption
        v-for="(label, value) in leadStatuses"
        :key="value"
        :value="value"
      >
        {{ label }}
      </AppSelectOption>
    </AppSelect>
    <p v-if="notice" class="toast" role="status">{{ notice }}</p>
    <p v-if="error" class="error-text">Не удалось загрузить заявки.</p>
    <div v-else class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th>Клиент</th>
            <th>Объект и комментарий</th>
            <th>Дата</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="lead in filtered" :key="lead.id">
            <td>
              {{ lead.name || "Имя не указано"
              }}<small
                ><a :href="'tel:' + lead.phone" class="underline">{{
                  lead.phone
                }}</a></small
              >
            </td>
            <td class="max-w-sm break-words">
              {{ lead.property?.title || "Подбор квартиры"
              }}<small>{{ lead.comment }}</small>
            </td>
            <td>
              {{
                new Date(lead.createdAt).toLocaleString("ru-RU", {
                  timeZone: "Europe/Kaliningrad",
                })
              }}
            </td>
            <td>
              <AppSelect
                :value="lead.status"
                :aria-label="'Статус заявки ' + (lead.name || lead.phone)"
                @change="change(lead.id, $event)"
              >
                <AppSelectOption
                  v-for="(label, value) in leadStatuses"
                  :key="value"
                  :value="value"
                >
                  {{ label }}
                </AppSelectOption>
              </AppSelect>
            </td>
          </tr>
          <tr v-if="!filtered.length">
            <td colspan="4">Заявок пока нет.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
