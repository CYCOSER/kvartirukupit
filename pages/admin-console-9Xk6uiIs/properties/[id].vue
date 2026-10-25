<script setup lang="ts">
import type { Property } from "~/shared/property";
definePageMeta({ middleware: "admin", layout: "admin" });
const route = useRoute();
const { data, error } = await useFetch<Property>(
  "/api/admin/properties/" + route.params.id,
);
if (!data.value)
  throw createError({
    statusCode: error.value?.statusCode || 404,
    statusMessage: "Объект не найден",
  });
</script>
<template>
  <div>
    <h1 class="admin-title">Редактирование объекта</h1>
    <PropertyEditor v-if="data" :initial="data" />
  </div>
</template>
