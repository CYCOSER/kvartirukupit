<script setup lang="ts">
import { tagSchema } from "~/shared/tag";

definePageMeta({ middleware: "admin", layout: "admin" });

type Tag = { id: string; name: string };

const { data, refresh, error } = await useFetch<Tag[]>("/api/admin/tags");
const editingId = ref("");
const name = ref("");
const creating = ref(false);
const pending = ref(false);
const notice = ref("");

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
    await refresh();
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
    await refresh();
    if (editingId.value === tag.id) cancelEdit();
    notice.value = "Тег удалён.";
  } catch {
    notice.value = "Не удалось удалить тег.";
  } finally {
    pending.value = false;
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
        <p v-if="error" class="error-text">Не удалось загрузить тэги.</p>
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
              <tr v-for="tag in data" :key="tag.id">
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
              <tr v-if="!data?.length">
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
    </div>
  </div>
</template>
