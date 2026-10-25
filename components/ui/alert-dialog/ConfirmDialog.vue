<script setup lang="ts">
import {
  AlertDialogRoot,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "reka-ui";
const open = defineModel<boolean>("open", { default: false });
defineProps<{ title: string; description: string }>();
defineEmits(["confirm"]);
</script>
<template>
  <AlertDialogRoot v-model:open="open"
    ><AlertDialogPortal
      ><AlertDialogOverlay
        class="fixed inset-0 z-50 bg-navy/50"
      /><AlertDialogContent
        class="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-8"
        ><AlertDialogTitle class="text-xl font-bold">{{
          title
        }}</AlertDialogTitle
        ><AlertDialogDescription class="my-5 text-slate-600">{{
          description
        }}</AlertDialogDescription>
        <div class="flex justify-end gap-3">
          <AlertDialogCancel class="btn-secondary">Отмена</AlertDialogCancel
          ><AlertDialogAction class="btn-danger" @click="$emit('confirm')"
            >Удалить</AlertDialogAction
          >
        </div></AlertDialogContent
      ></AlertDialogPortal
    ></AlertDialogRoot
  >
</template>
