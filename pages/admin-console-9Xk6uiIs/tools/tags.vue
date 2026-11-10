<script setup lang="ts">
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";
import { Tags, X } from "lucide-vue-next";
import { tagSchema } from "~/shared/tag";
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
const selectedTag = computed(() =>
  tags.value?.find((tag) => tag.id === selectedTagId.value),
);

watch(taskType, (type) => {
  taskParams.value = [
    { param: tagTaskFields[type][0].value, value_contain: "" },
  ];
});

function chooseTag(tag: Tag) {
  selectedTagId.value = tag.id;
  tagPickerOpen.value = false;
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
              <tr v-for="tag in tags" :key="tag.id">
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
        <h2 id="tag-tasks-title">Задания назначения тэгов</h2>
        <p v-if="taskNotice" class="toast" role="status">{{ taskNotice }}</p>
        <p v-if="tasksError" class="error-text">
          Не удалось загрузить задания.
        </p>
        <div v-else class="admin-tag-task-list">
          <article v-for="task in tasks" :key="task.id" class="admin-tag-task">
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
                @click="tagPickerOpen = true"
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
                <DialogTitle>Выберите тэг</DialogTitle>
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
      </section>
    </div>
  </div>
</template>
