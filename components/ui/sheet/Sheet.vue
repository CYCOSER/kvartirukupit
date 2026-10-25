<script setup lang="ts">
import {
  DialogRoot,
  DialogTrigger,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "reka-ui";
import { X } from "lucide-vue-next";
defineProps<{ title: string; description?: string; navigation?: boolean }>();
const open = defineModel<boolean>("open", { default: false });
</script>
<template>
  <DialogRoot v-model:open="open"
    ><DialogTrigger as-child><slot name="trigger" /></DialogTrigger
    ><DialogPortal
      ><DialogOverlay
        class="fixed inset-0 z-50 bg-navy/40 backdrop-blur-sm" /><DialogContent
        class="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto bg-white p-6 shadow-2xl"
        :class="{ 'navigation-sheet': navigation }"
        ><div class="flex items-start justify-between gap-4">
          <DialogTitle class="text-2xl font-semibold"
            ><slot name="title">{{ title }}</slot></DialogTitle
          ><DialogClose
            class="rounded-full p-2 hover:bg-slate-100"
            aria-label="Закрыть"
            ><X :size="22"
          /></DialogClose>
        </div>
        <DialogDescription
          class="sheet-description mt-2 text-sm text-slate-500"
          >{{
            description || "Выберите подходящие параметры."
          }}</DialogDescription
        >
        <div class="mt-8" :class="{ 'navigation-sheet-body': navigation }">
          <slot /></div></DialogContent></DialogPortal
  ></DialogRoot>
</template>
<style scoped>
.navigation-sheet {
  display: flex;
  flex-direction: column;
  background: #e6ecf5;
  color: #19365c;
  padding: 28px;
}
.navigation-sheet .sheet-description {
  color: #486387;
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.navigation-sheet-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  margin-top: 28px;
}
@media (max-width: 380px) {
  .navigation-sheet {
    padding: 20px;
  }
}
</style>
