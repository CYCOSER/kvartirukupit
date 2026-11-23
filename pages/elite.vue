<script setup lang="ts">

const config = useRuntimeConfig();

useHead({
  script: [
    {
      type: "application/ld+json",
      innerHTML: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: "Готовые квартиры в Калининграде — каталог",
      }).replace(/</g, "\\u003c"),
    },
  ],
});

usePageSeo(
  "Готовые квартиры в Калининграде — каталог",
  "Каталог готовых квартир в Калининграде. Выберите район и планировку, которая устроит именно вас. Поможем с подбором квартиры и организуем просмотр.",
);
</script>

<template>
  <PropertyCatalog elite />
</template>
