<script setup lang="ts">
import type Quill from "quill";
import "quill/dist/quill.snow.css";
import { articleContentToHtml } from "~/shared/article-content";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    disabled?: boolean;
    ariaLabel?: string;
    htmlMode?: boolean;
  }>(),
  { disabled: false, ariaLabel: "Текст статьи", htmlMode: false },
);
const emit = defineEmits<{
  "update:modelValue": [value: string];
  "update:htmlMode": [value: boolean];
}>();
const host = ref<HTMLDivElement>();
const quill = shallowRef<Quill>();
const htmlSource = ref("");

function toolbarRoot() {
  return host.value?.parentElement ?? host.value;
}

function setToolbarLabels(element: HTMLElement) {
  const labels: Record<string, string> = {
    undo: "Отменить",
    redo: "Повторить",
    html: "Редактировать HTML",
    bold: "Полужирный",
    italic: "Курсив",
    underline: "Подчёркнутый",
    strike: "Зачёркнутый",
    blockquote: "Цитата",
    link: "Вставить ссылку",
    clean: "Очистить форматирование",
    ordered: "Нумерованный список",
    bullet: "Маркированный список",
  };
  element
    .querySelectorAll<HTMLButtonElement>(".ql-toolbar button")
    .forEach((button) => {
      const format = Object.keys(labels).find((key) =>
        button.classList.contains(`ql-${key}`),
      );
      if (format) button.setAttribute("aria-label", labels[format]);
    });
  element
    .querySelector<HTMLSelectElement>(".ql-header")
    ?.setAttribute("aria-label", "Стиль абзаца");
  for (const [format, icon] of [
    [
      "undo",
      '<svg viewBox="0 0 18 18" aria-hidden="true"><path class="ql-stroke" d="M7 7H3V3"></path><path class="ql-stroke" d="M3 7c1.5-2 3.8-3 6.1-2.5 2.5.5 4.1 2.3 4.1 4.8s-1.6 4.2-4.1 4.7"></path></svg>',
    ],
    [
      "redo",
      '<svg viewBox="0 0 18 18" aria-hidden="true"><path class="ql-stroke" d="M11 7h4V3"></path><path class="ql-stroke" d="M15 7c-1.5-2-3.8-3-6.1-2.5C6.4 5 4.8 7.3 4.8 9.3s1.6 4.2 4.1 4.7"></path></svg>',
    ],
  ]) {
    const button = element.querySelector<HTMLButtonElement>(`.ql-${format}`);
    if (!button) continue;
    button.innerHTML = icon;
    button.title = labels[format];
  }
  const htmlButton = element.querySelector<HTMLButtonElement>(".ql-html");
  if (htmlButton) {
    htmlButton.textContent = "HTML";
    htmlButton.title = labels.html;
  }
}

function setHtmlMode(enabled: boolean) {
  const editor = quill.value;
  if (!editor) return;

  if (enabled) {
    htmlSource.value = editor.getText().trim() ? editor.getSemanticHTML() : "";
  } else {
    editor.clipboard.dangerouslyPasteHTML(htmlSource.value, "silent");
    const value = editor.getText().trim() ? editor.getSemanticHTML() : "";
    emit("update:modelValue", value);
    htmlSource.value = value;
  }

  editor.history.clear();
  const root = toolbarRoot();
  if (root) updateHistoryButtons(editor, root);
  emit("update:htmlMode", enabled);
  root
    ?.querySelector<HTMLButtonElement>(".ql-html")
    ?.setAttribute("aria-pressed", String(enabled));
}

function updateHistoryButtons(editor: Quill, element: HTMLElement) {
  const { undo, redo } = editor.history.stack;
  const undoButton = element.querySelector<HTMLButtonElement>(".ql-undo");
  const redoButton = element.querySelector<HTMLButtonElement>(".ql-redo");
  if (undoButton) undoButton.disabled = undo.length === 0;
  if (redoButton) redoButton.disabled = redo.length === 0;
}

onMounted(async () => {
  if (!host.value) return;
  const { default: QuillEditor } = await import("quill");
  if (!host.value) return;

  const editor = new QuillEditor(host.value, {
    theme: "snow",
    formats: [
      "bold",
      "italic",
      "underline",
      "strike",
      "header",
      "list",
      "blockquote",
      "link",
    ],
    modules: {
      toolbar: {
        container: [
          [{ header: [2, 3, false] }],
          ["bold", "italic", "underline", "strike"],
          [{ list: "ordered" }, { list: "bullet" }],
          ["blockquote", "link"],
          ["undo", "redo", "html", "clean"],
        ],
        handlers: {
          undo: () => quill.value?.history.undo(),
          redo: () => quill.value?.history.redo(),
          html: () => setHtmlMode(!props.htmlMode),
        },
      },
      clipboard: { matchers: [] },
      keyboard: { bindings: {} },
      history: { delay: 1000, maxStack: 100, userOnly: true },
    },
  });
  quill.value = editor;
  editor.root.setAttribute("aria-label", props.ariaLabel);
  editor.root.setAttribute("aria-multiline", "true");
  editor.enable(!props.disabled);
  const root = toolbarRoot();
  if (root) {
    setToolbarLabels(root);
    updateHistoryButtons(editor, root);
  }
  editor.clipboard.dangerouslyPasteHTML(
    articleContentToHtml(props.modelValue),
    "silent",
  );
  editor.on("text-change", () => {
    const value = editor.getText().trim() ? editor.getSemanticHTML() : "";
    emit("update:modelValue", value);
    const root = toolbarRoot();
    if (root) updateHistoryButtons(editor, root);
  });
});

watch(
  () => props.modelValue,
  (value) => {
    if (props.htmlMode) {
      htmlSource.value = value;
      return;
    }
    const editor = quill.value;
    if (!editor || editor.getSemanticHTML() === value) return;
    editor.clipboard.dangerouslyPasteHTML(
      articleContentToHtml(value),
      "silent",
    );
  },
);

watch(htmlSource, (value) => emit("update:modelValue", value));

watch(
  () => props.disabled,
  (disabled) => quill.value?.enable(!disabled),
);
</script>

<template>
  <div class="article-rich-editor" :class="{ 'ql-html-mode': htmlMode }">
    <div ref="host" />
    <textarea
      v-if="htmlMode"
      v-model="htmlSource"
      class="article-html-source"
      :disabled="disabled"
      :aria-label="`${ariaLabel}: HTML`"
      maxlength="50000"
      spellcheck="false"
      placeholder="<p>Текст статьи</p>"
    />
  </div>
</template>

<style scoped>
.article-rich-editor {
  color: #23334d;
}
.article-rich-editor :deep(.ql-html) {
  width: 42px;
  font-size: 11px;
  font-weight: 700;
}
.article-rich-editor :deep(.ql-html[aria-pressed="true"]) {
  border-radius: 4px;
  color: #245fbd;
  background: #e9f1fb;
}
.article-rich-editor :deep(.ql-toolbar button:disabled) {
  opacity: 0.4;
  cursor: default;
}
.article-rich-editor :deep(.ql-toolbar.ql-snow) {
  border-color: #cfdeea;
  border-radius: 8px 8px 0 0;
  background: #f9fbfe;
}
.article-rich-editor :deep(.ql-container.ql-snow) {
  min-height: 280px;
  border-color: #cfdeea;
  border-radius: 0 0 8px 8px;
  font: inherit;
}
.article-rich-editor :deep(.ql-editor) {
  min-height: 280px;
  font-size: 15px;
  line-height: 1.75;
}
.article-rich-editor :deep(.ql-editor.ql-blank::before) {
  color: #8391a5;
  font-style: normal;
}
.article-rich-editor :deep(.ql-toolbar button:focus-visible),
.article-rich-editor :deep(.ql-toolbar select:focus-visible),
.article-rich-editor :deep(.ql-editor:focus-visible) {
  outline: 2px solid #245fbd;
  outline-offset: 2px;
}
.article-rich-editor :deep(.ql-toolbar button:not(.ql-html)),
.article-rich-editor :deep(.ql-toolbar select) {
  transition: opacity 0.15s ease;
}
.article-rich-editor.ql-html-mode :deep(.ql-container),
.article-rich-editor.ql-html-mode :deep(.ql-toolbar button:not(.ql-html)),
.article-rich-editor.ql-html-mode :deep(.ql-toolbar select) {
  display: none;
}
.article-rich-editor.ql-html-mode :deep(.ql-toolbar.ql-snow) {
  border-radius: 8px;
}
.article-html-source {
  display: block;
  width: 100%;
  min-height: 280px;
  padding: 14px;
  border: 1px solid #cfdeea;
  border-radius: 8px;
  color: #23334d;
  background: #fff;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  line-height: 1.65;
  resize: vertical;
}
.article-html-source:focus-visible {
  outline: 2px solid #245fbd;
  outline-offset: 2px;
}
</style>
