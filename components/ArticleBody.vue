<script setup lang="ts">
import { articleBlocks } from "~/shared/article";
const props = defineProps<{ content: string }>();
const blocks = computed(() => articleBlocks(props.content));
</script>
<template>
  <div class="article-body">
    <template v-for="(block, i) in blocks" :key="i"
      ><h2 v-if="block.type === 'h2'">{{ block.text }}</h2>
      <h3 v-else-if="block.type === 'h3'">{{ block.text }}</h3>
      <ul v-else-if="block.type === 'list'">
        <li v-for="(item, j) in block.items" :key="j">{{ item }}</li>
      </ul>
      <p v-else-if="block.type === 'link'" class="article-link">
        <a :href="block.href">{{ block.text }} ↗</a>
      </p>
      <p v-else>{{ block.text }}</p></template
    >
  </div>
</template>
<style scoped>
.article-body {
  font-size: 1rem;
  line-height: 1.9;
  overflow-wrap: anywhere;
}
.article-body p {
  white-space: pre-line;
  margin: 18px 0;
}
.article-body h2 {
  font-size: 1.8rem;
  margin: 36px 0 16px;
}
.article-body h3 {
  font-size: 1.3rem;
  margin: 24px 0 12px;
}
.article-body ul {
  list-style: disc;
  padding-left: 24px;
  margin: 18px 0;
}
.article-link a {
  color: #245fbd;
  text-decoration: underline;
  text-underline-offset: 4px;
}
</style>
