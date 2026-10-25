<script setup lang="ts">
import { ConfigProvider } from "reka-ui";
</script>
<template>
  <!-- The stable root scrollbar gutter already reserves the space for modal locks. -->
  <ConfigProvider :scroll-body="false">
    <NuxtLayout><NuxtPage /></NuxtLayout>
  </ConfigProvider>
</template>
