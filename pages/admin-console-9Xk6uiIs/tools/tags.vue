<script setup lang="ts">
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";
import { ChevronLeft, ChevronRight, Tags, X } from "lucide-vue-next";
import { manualTagRelationsSchema, tagSchema } from "~/shared/tag";
import {
  tagTaskFields,
  tagTaskSchema,
  tagTaskTypeLabels,
  tagTaskTypes,
  type TagTaskParameter,
  type TagTaskType,
} from "~/shared/tag-task";

definePageMeta({ middleware: "admin", layout: "admin" });

type Tag = { id: string; name: string };
type TagTask = {
  id: string;
  type: TagTaskType;
  params: TagTaskParameter[];
  tag: Tag;
};
type ManualTarget = {
  id: string;
  title: string;
  label: string;
  image: string;
  kind: "property" | "article";
};
type PropertyTarget = {
  id: string;
  title: string;
  type: string;
  address: string;
  location: string;
  images: { file: string }[];
};
type ArticleTarget = {
  id: string;
  title: string;
  slug: string;
  image: string;
};

const {
  data: tags,
  refresh: refreshTags,
  error: tagsError,
} = await useFetch<Tag[]>("/api/admin/tags");
const {
  data: tasks,
  refresh: refreshTasks,
  error: tasksError,
} = await useFetch<TagTask[]>("/api/admin/tags-tasks");
const tagsPage = ref(1);
const tasksPage = ref(1);
const tagsPerPage = 20;
const tasksPerPage = 10;
const paginatedTags = computed(
  () =>
    tags.value?.slice(
      (tagsPage.value - 1) * tagsPerPage,
      tagsPage.value * tagsPerPage,
    ) || [],
);
const paginatedTasks = computed(
  () =>
    tasks.value?.slice(
      (tasksPage.value - 1) * tasksPerPage,
      tasksPage.value * tasksPerPage,
    ) || [],
);
const tagsPageCount = computed(() =>
  Math.max(1, Math.ceil((tags.value?.length || 0) / tagsPerPage)),
);
const tasksPageCount = computed(() =>
  Math.max(1, Math.ceil((tasks.value?.length || 0) / tasksPerPage)),
);
const editingId = ref("");
const name = ref("");
const creating = ref(false);
const pending = ref(false);
const notice = ref("");
const tagPickerOpen = ref(false);
const selectedTagId = ref("");
const taskType = ref<TagTaskType>("complex");
const taskParams = ref<TagTaskParameter[]>([
  { param: "title", value_contain: "" },
]);
const taskPendingId = ref("");
const taskNotice = ref("");
const taskPending = ref(false);
const taskFields = computed(() => tagTaskFields[taskType.value]);
const tagPickerPurpose = ref<"task" | "manual">("task");
const selectedTag = computed(() =>
  tags.value?.find((tag) => tag.id === selectedTagId.value),
);
const manualTagId = ref("");
const manualTag = computed(() =>
  tags.value?.find((tag) => tag.id === manualTagId.value),
);
const manualPending = ref(false);
const manualNotice = ref("");
const targetPickerOpen = ref(false);
const targetPickerType = ref<"property" | "article">("property");
const targetPickerPage = ref(1);
const propertyTargetSearch = ref("");
const articleTargetSearch = ref("");
const targetPickerSearch = computed(() =>
  targetPickerType.value === "property"
    ? propertyTargetSearch.value
    : articleTargetSearch.value,
);
const targetPickerLoading = ref(false);
const targetPickerError = ref("");
const targetPickerItems = ref<(PropertyTarget | ArticleTarget)[]>([]);
const targetPickerTotal = ref(0);
const selectedTargets = ref<Record<string, ManualTarget>>({});
const draftTargets = ref<Record<string, ManualTarget>>({});
const targetPickerPageCount = computed(() =>
  Math.max(1, Math.ceil(targetPickerTotal.value / 10)),
);
const selectedTargetCount = computed(
  () => Object.keys(selectedTargets.value).length,
);
let targetPickerRequest = 0;

watch(taskType, (type) => {
  taskParams.value = [
    { param: tagTaskFields[type][0].value, value_contain: "" },
  ];
});

watch([tagsPageCount, tasksPageCount], ([tagCount, taskCount]) => {
  tagsPage.value = Math.min(tagsPage.value, tagCount);
  tasksPage.value = Math.min(tasksPage.value, taskCount);
});

watch(
  [targetPickerOpen, targetPickerType, targetPickerPage, targetPickerSearch],
  async ([open, type, page, search]) => {
    if (!open) {
      targetPickerRequest += 1;
      targetPickerLoading.value = false;
      return;
    }
    const request = ++targetPickerRequest;
    targetPickerLoading.value = true;
    targetPickerError.value = "";
    try {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (request !== targetPickerRequest) return;
      if (type === "property") {
        const result = await $fetch<{
          items: PropertyTarget[];
          total: number;
        }>("/api/admin/tag-targets/properties", {
          query: { page, q: search.trim() },
        });
        if (request !== targetPickerRequest) return;
        targetPickerItems.value = result.items;
        targetPickerTotal.value = result.total;
      } else {
        const result = await $fetch<{
          items: ArticleTarget[];
          total: number;
        }>("/api/admin/tag-targets/articles", {
          query: { page, q: search.trim() },
        });
        if (request !== targetPickerRequest) return;
        targetPickerItems.value = result.items;
        targetPickerTotal.value = result.total;
      }
    } catch {
      if (request === targetPickerRequest)
        targetPickerError.value = "Не удалось загрузить список.";
    } finally {
      if (request === targetPickerRequest) targetPickerLoading.value = false;
    }
  },
);

function openTagPicker(purpose: "task" | "manual") {
  tagPickerPurpose.value = purpose;
  tagPickerOpen.value = true;
}

function chooseTag(tag: Tag) {
  if (tagPickerPurpose.value === "manual") manualTagId.value = tag.id;
  else selectedTagId.value = tag.id;
  tagPickerOpen.value = false;
}

function targetToSelection(
  target: PropertyTarget | ArticleTarget,
): ManualTarget {
  if ("images" in target) {
    return {
      id: target.id,
      title: target.title,
      label: `${target.type === "apartment" ? "Квартира" : "ЖК"} · ${target.address || target.location || target.title}`,
      image: target.images[0]?.file || "",
      kind: "property",
    };
  }
  return {
    id: target.id,
    title: target.title,
    label: `Статья · ${target.title}`,
    image: target.image,
    kind: "article",
  };
}

function targetSelectionKey(target: PropertyTarget | ArticleTarget) {
  return `${"images" in target ? "property" : "article"}:${target.id}`;
}

function targetImage(target: PropertyTarget | ArticleTarget) {
  return "images" in target ? target.images[0]?.file || "" : target.image;
}

function targetTypeLabel(target: PropertyTarget | ArticleTarget) {
  if (!("type" in target)) return "Статья";
  return target.type === "apartment" ? "Квартира" : "ЖК";
}

function targetAddress(target: PropertyTarget | ArticleTarget) {
  if (!("address" in target)) return target.title;
  return target.address || target.location || target.title;
}

function openTargetPicker() {
  draftTargets.value = { ...selectedTargets.value };
  targetPickerType.value = "property";
  targetPickerPage.value = 1;
  targetPickerError.value = "";
  targetPickerOpen.value = true;
}

function setTargetPickerSearch(value: string) {
  if (targetPickerType.value === "property") propertyTargetSearch.value = value;
  else articleTargetSearch.value = value;
  targetPickerPage.value = 1;
}

function toggleTarget(target: PropertyTarget | ArticleTarget, event: Event) {
  const checkbox = event.target as HTMLInputElement;
  const next = { ...draftTargets.value };
  const key = targetSelectionKey(target);
  if (checkbox.checked) next[key] = targetToSelection(target);
  else delete next[key];
  draftTargets.value = next;
}

function confirmTargetSelection() {
  selectedTargets.value = { ...draftTargets.value };
  targetPickerOpen.value = false;
}

function targetSelectionSummary() {
  const selections = Object.values(selectedTargets.value);
  if (!selections.length) return "";
  const labels = selections.slice(0, 3).map((target) => target.label);
  const remaining = selections.length - labels.length;
  return labels.join("; ") + (remaining ? `; + ещё ${remaining}` : "");
}

async function saveManualAssignments() {
  const propertyIds = Object.values(selectedTargets.value)
    .filter((target) => target.kind === "property")
    .map((target) => target.id);
  const articleIds = Object.values(selectedTargets.value)
    .filter((target) => target.kind === "article")
    .map((target) => target.id);
  const parsed = manualTagRelationsSchema.safeParse({
    tag_id: manualTagId.value,
    property_ids: propertyIds,
    article_ids: articleIds,
  });
  if (!parsed.success) {
    manualNotice.value = "Выберите тэг и хотя бы один объект или статью.";
    return;
  }

  manualPending.value = true;
  manualNotice.value = "";
  try {
    const result = await $fetch<{
      propertyRelationsCreated: number;
      articleRelationsCreated: number;
    }>("/api/admin/tags/relations", {
      method: "POST",
      body: parsed.data,
    });
    manualNotice.value = `Назначено связей: ${result.propertyRelationsCreated + result.articleRelationsCreated}.`;
    manualTagId.value = "";
    selectedTargets.value = {};
  } catch {
    manualNotice.value = "Не удалось назначить тэг.";
  } finally {
    manualPending.value = false;
  }
}

function addTaskParameter() {
  taskParams.value.push({
    param: taskFields.value[0].value,
    value_contain: "",
  });
}

function removeTaskParameter(index: number) {
  if (taskParams.value.length > 1) taskParams.value.splice(index, 1);
}

function taskParameterLabel(task: TagTask, parameter: TagTaskParameter) {
  const field = tagTaskFields[task.type].find(
    (option) => option.value === parameter.param,
  );
  return field?.label || parameter.param;
}

function startCreate() {
  editingId.value = "";
  name.value = "";
  creating.value = true;
  notice.value = "";
}

function startEdit(tag: Tag) {
  creating.value = false;
  editingId.value = tag.id;
  name.value = tag.name;
  notice.value = "";
}

function cancelEdit() {
  creating.value = false;
  editingId.value = "";
  name.value = "";
}

async function save() {
  const parsed = tagSchema.safeParse({ name: name.value });
  if (!parsed.success) {
    notice.value = "Введите название тега (до 100 символов).";
    return;
  }

  pending.value = true;
  try {
    await $fetch<Tag>(
      "/api/admin/tags" + (editingId.value ? `/${editingId.value}` : ""),
      {
        method: editingId.value ? "PUT" : "POST",
        body: parsed.data,
      },
    );
    await Promise.all([refreshTags(), refreshTasks()]);
    cancelEdit();
    notice.value = "Тег сохранён.";
  } catch (error: unknown) {
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error
        ? error.statusCode
        : undefined;
    notice.value =
      statusCode === 409
        ? "Тег с таким названием уже существует."
        : "Не удалось сохранить тег.";
  } finally {
    pending.value = false;
  }
}

async function remove(tag: Tag) {
  if (!confirm(`Удалить тег «${tag.name}»?`)) return;

  pending.value = true;
  try {
    await $fetch(`/api/admin/tags/${tag.id}`, { method: "DELETE" });
    await Promise.all([refreshTags(), refreshTasks()]);
    if (selectedTagId.value === tag.id) selectedTagId.value = "";
    if (manualTagId.value === tag.id) manualTagId.value = "";
    if (editingId.value === tag.id) cancelEdit();
    notice.value = "Тег удалён.";
  } catch {
    notice.value = "Не удалось удалить тег.";
  } finally {
    pending.value = false;
  }
}

async function saveTask() {
  const parsed = tagTaskSchema.safeParse({
    tag_id: selectedTagId.value,
    type: taskType.value,
    params: taskParams.value,
  });
  if (!parsed.success) {
    taskNotice.value =
      "Выберите тэг и заполните значение для каждого параметра.";
    return;
  }

  taskPending.value = true;
  try {
    await $fetch<TagTask>("/api/admin/tags-tasks", {
      method: "POST",
      body: parsed.data,
    });
    await refreshTasks();
    tasksPage.value = 1;
    selectedTagId.value = "";
    taskType.value = "complex";
    taskParams.value = [{ param: "title", value_contain: "" }];
    taskNotice.value = "Задание создано.";
  } catch {
    taskNotice.value = "Не удалось создать задание.";
  } finally {
    taskPending.value = false;
  }
}

async function runTask(task: TagTask) {
  taskPendingId.value = task.id;
  taskNotice.value = "";
  try {
    const result = await $fetch<{
      matchedCount: number;
      assignedCount: number;
    }>(`/api/admin/tags-tasks/${task.id}/run`, { method: "POST" });
    taskNotice.value = `Задание выполнено: найдено ${result.matchedCount}, назначено тэгов ${result.assignedCount}.`;
  } catch {
    taskNotice.value = "Не удалось выполнить задание.";
  } finally {
    taskPendingId.value = "";
  }
}

async function removeTask(task: TagTask) {
  if (!confirm("Удалить задание автоматического назначения?")) return;

  taskPendingId.value = task.id;
  taskNotice.value = "";
  try {
    await $fetch(`/api/admin/tags-tasks/${task.id}`, { method: "DELETE" });
    await refreshTasks();
    taskNotice.value = "Задание удалено.";
  } catch {
    taskNotice.value = "Не удалось удалить задание.";
  } finally {
    taskPendingId.value = "";
  }
}
</script>

<template>
  <div>
    <h1 class="admin-title">Тэги</h1>
    <div class="admin-tags-layout">
      <section class="admin-tags-panel" aria-labelledby="tags-directory-title">
        <h2 id="tags-directory-title">Справочник тэгов</h2>
        <p v-if="notice" class="toast" role="status">{{ notice }}</p>
        <p v-if="tagsError" class="error-text">Не удалось загрузить тэги.</p>
        <div v-else class="admin-table-wrap">
          <table class="admin-table admin-tags-table">
            <thead>
              <tr>
                <th>id</th>
                <th>name</th>
                <th>actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="tag in paginatedTags" :key="tag.id">
                <td class="admin-tag-id">{{ tag.id }}</td>
                <td>
                  <input
                    v-if="editingId === tag.id"
                    v-model="name"
                    class="admin-tag-name-input"
                    maxlength="100"
                    aria-label="Название тега"
                    @keydown.enter.prevent="save"
                    @keydown.esc="cancelEdit"
                  />
                  <template v-else>{{ tag.name }}</template>
                </td>
                <td>
                  <div class="admin-tag-actions">
                    <template v-if="editingId === tag.id">
                      <button
                        class="btn-secondary"
                        :disabled="pending"
                        @click="save"
                      >
                        Сохранить
                      </button>
                      <button
                        class="btn-secondary"
                        :disabled="pending"
                        @click="cancelEdit"
                      >
                        Отмена
                      </button>
                    </template>
                    <template v-else>
                      <button
                        class="btn-secondary"
                        :disabled="pending"
                        @click="startEdit(tag)"
                      >
                        Редактировать
                      </button>
                      <button
                        class="btn-secondary"
                        :disabled="pending"
                        @click="remove(tag)"
                      >
                        Удалить
                      </button>
                    </template>
                  </div>
                </td>
              </tr>
              <tr v-if="!tags?.length">
                <td colspan="3">Тэгов пока нет.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <nav
          v-if="tagsPageCount > 1"
          class="admin-tag-pagination"
          aria-label="Страницы справочника тэгов"
        >
          <button
            type="button"
            class="btn-secondary"
            :disabled="tagsPage <= 1"
            aria-label="Предыдущая страница тэгов"
            @click="tagsPage--"
          >
            <ChevronLeft :size="16" aria-hidden="true" />
          </button>
          <span>Страница {{ tagsPage }} из {{ tagsPageCount }}</span>
          <button
            type="button"
            class="btn-secondary"
            :disabled="tagsPage >= tagsPageCount"
            aria-label="Следующая страница тэгов"
            @click="tagsPage++"
          >
            <ChevronRight :size="16" aria-hidden="true" />
          </button>
        </nav>

        <form v-if="creating" class="admin-tag-create" @submit.prevent="save">
          <label>
            Название тэга
            <input
              v-model="name"
              required
              maxlength="100"
              autofocus
              placeholder="Например, у моря"
            />
          </label>
          <div class="admin-tag-actions">
            <button class="btn-secondary" type="submit" :disabled="pending">
              Сохранить
            </button>
            <button
              class="btn-secondary"
              type="button"
              :disabled="pending"
              @click="cancelEdit"
            >
              Отмена
            </button>
          </div>
        </form>
        <button
          v-else
          class="btn-secondary admin-tag-create-button"
          :disabled="pending"
          @click="startCreate"
        >
          Создать
        </button>
      </section>
      <section
        class="admin-tags-panel admin-tag-tasks-panel"
        aria-labelledby="tag-tasks-title"
      >
        <form
          class="admin-tag-manual-form"
          @submit.prevent="saveManualAssignments"
        >
          <h2>Ручное назначение тэгов</h2>
          <p v-if="manualNotice" class="toast" role="status">
            {{ manualNotice }}
          </p>
          <label class="admin-tag-task-label">
            Тэг
            <span class="admin-tag-picker-field">
              <input
                :value="manualTag?.name || ''"
                type="text"
                readonly
                required
                placeholder="Выберите тэг"
                aria-label="Тэг для ручного назначения"
              />
              <button
                type="button"
                class="admin-tag-picker-button"
                aria-label="Открыть список тэгов для ручного назначения"
                :disabled="manualPending"
                @click="openTagPicker('manual')"
              >
                <Tags :size="18" aria-hidden="true" />
              </button>
            </span>
          </label>
          <label class="admin-tag-task-label">
            Объекты и статьи
            <span class="admin-tag-picker-field">
              <input
                :value="targetSelectionSummary()"
                type="text"
                readonly
                placeholder="Ничего не выбрано"
                aria-label="Выбранные объекты и статьи"
              />
              <button
                type="button"
                class="admin-tag-picker-button"
                aria-label="Выбрать объекты и статьи"
                :disabled="manualPending"
                @click="openTargetPicker"
              >
                <Tags :size="18" aria-hidden="true" />
              </button>
            </span>
            <small v-if="selectedTargetCount">
              Выбрано: {{ selectedTargetCount }}
            </small>
          </label>
          <button
            class="btn-primary admin-tag-task-submit"
            type="submit"
            :disabled="manualPending || !manualTag || !selectedTargetCount"
          >
            {{ manualPending ? "Применяем…" : "Применить" }}
          </button>
        </form>

        <h2 id="tag-tasks-title">Задания назначения тэгов</h2>
        <p v-if="taskNotice" class="toast" role="status">{{ taskNotice }}</p>
        <p v-if="tasksError" class="error-text">
          Не удалось загрузить задания.
        </p>
        <div v-else class="admin-tag-task-list">
          <article
            v-for="task in paginatedTasks"
            :key="task.id"
            class="admin-tag-task"
          >
            <div class="admin-tag-task-heading">
              <strong>{{ task.tag.name }}</strong>
              <span>{{ tagTaskTypeLabels[task.type] }}</span>
            </div>
            <ul>
              <li v-for="(parameter, index) in task.params" :key="index">
                {{ taskParameterLabel(task, parameter) }} содержит «{{
                  parameter.value_contain
                }}»
              </li>
            </ul>
            <div class="admin-tag-actions">
              <button
                class="btn-secondary"
                :disabled="!!taskPendingId || taskPending"
                @click="runTask(task)"
              >
                {{ taskPendingId === task.id ? "Выполняется…" : "Запустить" }}
              </button>
              <button
                class="btn-secondary"
                :disabled="!!taskPendingId || taskPending"
                @click="removeTask(task)"
              >
                Удалить
              </button>
            </div>
          </article>
          <p v-if="!tasks?.length" class="admin-tag-task-empty">
            Заданий пока нет.
          </p>
        </div>
        <nav
          v-if="tasksPageCount > 1"
          class="admin-tag-pagination"
          aria-label="Страницы заданий назначения тэгов"
        >
          <button
            type="button"
            class="btn-secondary"
            :disabled="tasksPage <= 1"
            aria-label="Предыдущая страница заданий"
            @click="tasksPage--"
          >
            <ChevronLeft :size="16" aria-hidden="true" />
          </button>
          <span>Страница {{ tasksPage }} из {{ tasksPageCount }}</span>
          <button
            type="button"
            class="btn-secondary"
            :disabled="tasksPage >= tasksPageCount"
            aria-label="Следующая страница заданий"
            @click="tasksPage++"
          >
            <ChevronRight :size="16" aria-hidden="true" />
          </button>
        </nav>

        <form class="admin-tag-task-form" @submit.prevent="saveTask">
          <h3>Создать задание</h3>
          <p class="admin-tag-task-hint">
            Условия «содержит» для нескольких параметров применяются вместе (И).
          </p>
          <label class="admin-tag-task-label">
            Тэг
            <span class="admin-tag-picker-field">
              <input
                :value="selectedTag?.name || ''"
                type="text"
                readonly
                required
                placeholder="Выберите тэг"
                aria-label="Выбранный тэг"
              />
              <button
                type="button"
                class="admin-tag-picker-button"
                aria-label="Открыть список тэгов"
                :disabled="taskPending"
                @click="openTagPicker('task')"
              >
                <Tags :size="18" aria-hidden="true" />
              </button>
            </span>
          </label>
          <label class="admin-tag-task-label">
            Тип
            <AppSelect v-model="taskType" aria-label="Тип задания">
              <AppSelectOption
                v-for="type in tagTaskTypes"
                :key="type"
                :value="type"
              >
                {{ tagTaskTypeLabels[type] }}
              </AppSelectOption>
            </AppSelect>
          </label>
          <div class="admin-tag-task-parameters">
            <div
              v-for="(parameter, index) in taskParams"
              :key="index"
              class="admin-tag-task-parameter"
            >
              <label class="admin-tag-task-label">
                Параметр
                <AppSelect
                  v-model="parameter.param"
                  :aria-label="`Параметр ${index + 1}`"
                >
                  <AppSelectOption
                    v-for="field in taskFields"
                    :key="field.value"
                    :value="field.value"
                  >
                    {{ field.label }}
                  </AppSelectOption>
                </AppSelect>
              </label>
              <div class="admin-tag-task-value">
                <input
                  v-model="parameter.value_contain"
                  type="text"
                  required
                  maxlength="200"
                  :aria-label="`Значение параметра ${index + 1}`"
                  placeholder="Содержит"
                />
                <button
                  v-if="taskParams.length > 1"
                  type="button"
                  class="admin-tag-task-remove-parameter"
                  :aria-label="`Удалить параметр ${index + 1}`"
                  @click="removeTaskParameter(index)"
                >
                  <X :size="17" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
          <button
            type="button"
            class="btn-secondary admin-tag-create-button"
            :disabled="taskPending || taskParams.length >= 20"
            @click="addTaskParameter"
          >
            Добавить параметр
          </button>
          <button
            class="btn-primary admin-tag-task-submit"
            type="submit"
            :disabled="taskPending || !selectedTag"
          >
            {{ taskPending ? "Сохраняем…" : "Создать задание" }}
          </button>
        </form>

        <DialogRoot v-model:open="tagPickerOpen">
          <DialogPortal>
            <DialogOverlay class="admin-tag-picker-overlay" />
            <DialogContent class="admin-tag-picker-dialog">
              <div class="admin-tag-picker-heading">
                <DialogTitle>
                  {{
                    tagPickerPurpose === "manual"
                      ? "Выберите тэг для ручного назначения"
                      : "Выберите тэг"
                  }}
                </DialogTitle>
                <button
                  type="button"
                  aria-label="Закрыть список тэгов"
                  @click="tagPickerOpen = false"
                >
                  <X :size="20" aria-hidden="true" />
                </button>
              </div>
              <p v-if="!tags?.length" class="admin-tag-task-empty">
                Сначала создайте тэг в справочнике.
              </p>
              <div v-else class="admin-tag-picker-list">
                <button
                  v-for="tag in tags"
                  :key="tag.id"
                  type="button"
                  @click="chooseTag(tag)"
                >
                  {{ tag.name }}
                </button>
              </div>
            </DialogContent>
          </DialogPortal>
        </DialogRoot>

        <DialogRoot v-model:open="targetPickerOpen">
          <DialogPortal>
            <DialogOverlay class="admin-tag-picker-overlay" />
            <DialogContent class="admin-target-picker-dialog">
              <div class="admin-tag-picker-heading">
                <DialogTitle>Выберите объекты и статьи</DialogTitle>
                <button
                  type="button"
                  aria-label="Закрыть список объектов и статей"
                  @click="targetPickerOpen = false"
                >
                  <X :size="20" aria-hidden="true" />
                </button>
              </div>
              <div
                class="admin-target-picker-tabs"
                role="group"
                aria-label="Тип выбираемых материалов"
              >
                <button
                  type="button"
                  :aria-pressed="targetPickerType === 'property'"
                  :class="{ 'is-active': targetPickerType === 'property' }"
                  @click="
                    targetPickerType = 'property';
                    targetPickerPage = 1;
                  "
                >
                  Объекты
                </button>
                <button
                  type="button"
                  :aria-pressed="targetPickerType === 'article'"
                  :class="{ 'is-active': targetPickerType === 'article' }"
                  @click="
                    targetPickerType = 'article';
                    targetPickerPage = 1;
                  "
                >
                  Статьи
                </button>
              </div>
              <label class="admin-target-picker-search">
                <span class="sr-only">
                  {{
                    targetPickerType === "property"
                      ? "Поиск объектов по адресу"
                      : "Поиск статей по названию"
                  }}
                </span>
                <input
                  :value="targetPickerSearch"
                  type="search"
                  maxlength="100"
                  :placeholder="
                    targetPickerType === 'property'
                      ? 'Поиск по адресу'
                      : 'Поиск по названию статьи'
                  "
                  @input="
                    setTargetPickerSearch(
                      ($event.target as HTMLInputElement).value,
                    )
                  "
                />
              </label>
              <p
                v-if="targetPickerError"
                class="error-text target-picker-message"
              >
                {{ targetPickerError }}
              </p>
              <p
                v-else-if="targetPickerLoading"
                class="admin-tag-task-empty target-picker-message"
                role="status"
              >
                Загружаем…
              </p>
              <p
                v-else-if="!targetPickerItems.length"
                class="admin-tag-task-empty target-picker-message"
              >
                {{
                  targetPickerSearch.trim()
                    ? "По запросу ничего не найдено."
                    : "Список пуст."
                }}
              </p>
              <div v-else class="admin-target-picker-list">
                <label
                  v-for="target in targetPickerItems"
                  :key="target.id"
                  class="admin-target-picker-row"
                >
                  <input
                    type="checkbox"
                    :checked="!!draftTargets[targetSelectionKey(target)]"
                    :aria-label="`Выбрать ${targetPickerType === 'property' ? 'объект' : 'статью'} «${target.title}»`"
                    @change="toggleTarget(target, $event)"
                  />
                  <span class="admin-target-picker-image">
                    <img
                      v-if="targetImage(target)"
                      :src="targetImage(target)"
                      alt=""
                      loading="lazy"
                    />
                    <span v-else aria-hidden="true">—</span>
                  </span>
                  <span class="admin-target-picker-info">
                    <strong>{{ targetTypeLabel(target) }}</strong>
                    <span>{{ targetAddress(target) }}</span>
                  </span>
                </label>
              </div>
              <div class="admin-target-picker-footer">
                <nav
                  v-if="targetPickerPageCount > 1"
                  class="admin-tag-pagination"
                  aria-label="Страницы списка объектов и статей"
                >
                  <button
                    type="button"
                    class="btn-secondary"
                    :disabled="targetPickerPage <= 1 || targetPickerLoading"
                    aria-label="Предыдущая страница"
                    @click="targetPickerPage--"
                  >
                    <ChevronLeft :size="16" aria-hidden="true" />
                  </button>
                  <span>
                    Страница {{ targetPickerPage }} из
                    {{ targetPickerPageCount }}
                  </span>
                  <button
                    type="button"
                    class="btn-secondary"
                    :disabled="
                      targetPickerPage >= targetPickerPageCount ||
                      targetPickerLoading
                    "
                    aria-label="Следующая страница"
                    @click="targetPickerPage++"
                  >
                    <ChevronRight :size="16" aria-hidden="true" />
                  </button>
                </nav>
                <p class="admin-tag-task-hint">
                  Выбрано: {{ Object.keys(draftTargets).length }}
                </p>
                <button
                  type="button"
                  class="btn-primary admin-target-picker-confirm"
                  :disabled="targetPickerLoading || !!targetPickerError"
                  @click="confirmTargetSelection"
                >
                  ОК
                </button>
              </div>
            </DialogContent>
          </DialogPortal>
        </DialogRoot>
      </section>
    </div>
  </div>
</template>
