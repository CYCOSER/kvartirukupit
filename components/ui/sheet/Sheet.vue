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
            class="sheet-close rounded-full p-2 hover:bg-slate-100"
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
  top: 16px;
  right: 16px;
  bottom: 16px;
  width: calc(100% - 32px);
  max-width: 460px;
  border: 1px solid #ffffffb3;
  border-radius: 24px;
  background: radial-gradient(ellipse at 100% 0, #c7d9ef80, transparent 55%), linear-gradient(160deg, #f6f9fe, #dfe9f5);
  color: #19365c;
  padding: 28px;
  box-shadow: 0 24px 80px #102f5559;
  scrollbar-width: thin;
  scrollbar-color: #a4bcd7 transparent;
}
.navigation-sheet .sheet-close {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 1px solid #bacde380;
  background: #ffffff80;
}
.navigation-sheet .sheet-close:hover {
  background: white;
}
.navigation-sheet .sheet-close:focus-visible {
  outline: 2px solid #245f9b;
  outline-offset: 3px;
}
.navigation-sheet .sheet-description {
  color: #486387;
  margin-top: 12px;
  font-size: 0.6875rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.navigation-sheet-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  margin-top: 24px;
}
@media (max-width: 540px) {
  .navigation-sheet {
    inset: 0;
    width: 100%;
    max-width: none;
    border: 0;
    border-radius: 0;
    padding: 20px;
  }
}
@media (prefers-reduced-motion: no-preference) {
  .navigation-sheet[data-state="open"] { animation: navigation-enter 280ms cubic-bezier(0.2, 0.7, 0.3, 1); }
  .navigation-sheet[data-state="closed"] { animation: navigation-exit 180ms ease-in; }
  @keyframes navigation-enter { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes navigation-exit { to { opacity: 0; transform: translateX(24px); } }
}
</style>
