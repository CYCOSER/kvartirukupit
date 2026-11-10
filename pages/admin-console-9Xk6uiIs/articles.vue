<script setup lang="ts">
import Button from "~/components/ui/button/Button.vue";
import { emptyAdminExclusions, matchesAdminExclusions } from "~/shared/admin-exclusions";
import {
  articleSlugFromTitle,
  articleSchema,
  type Article,
  type ArticleInput,
} from "~/shared/article";
import ArticleRichTextEditor from "~/components/ArticleRichTextEditor.client.vue";
type ArticleForm = Omit<ArticleInput, "publishedAt"> & { publishedAt: string };
definePageMeta({ middleware: "admin", layout: "admin" });
const { data, refresh, error } = await useFetch<Article[]>(
  "/api/admin/articles",
);
const exclusions = ref(emptyAdminExclusions());
const exclusionFields = [{
  key: "publication", label: "Публикация статьи",
  options: [{ value: "published", label: "Опубликована" }, { value: "draft", label: "Черновик" }],
}];
const filtered = computed(() => data.value?.filter(article =>
  matchesAdminExclusions(exclusions.value,
    `${article.title} ${article.slug} ${article.excerpt} ${article.content}`,
    { publication: article.published ? "published" : "draft" })) || []);
const editing = ref(false),
  pending = ref(false),
  preview = ref(false);
const htmlMode = ref(false);
const editId = ref(""),
  notice = ref("");
const imageFile = ref<File>();
const currentImage = ref("");
const imagePreview = ref("");
const removeImage = ref(false);
const slugManuallyEdited = ref(false);
const empty = (): ArticleForm => ({
  title: "",
  slug: "",
  excerpt: "",
  content: "",
  imageAlt: "",
  seoTitle: "",
  seoDescription: "",
  seoKeywords: "",
  published: false,
  publishedAt: "",
});
const form = reactive(empty());
watch(
  () => form.title,
  (title) => {
    if (editing.value && !editId.value && !slugManuallyEdited.value)
      form.slug = articleSlugFromTitle(title);
  },
);
const excerptField = useAutoResizeTextarea(() => form.excerpt);
const seoDescriptionField = useAutoResizeTextarea(() => form.seoDescription);
const seoKeywordsField = useAutoResizeTextarea(() => form.seoKeywords);
function clearPreview() {
  if (imagePreview.value) URL.revokeObjectURL(imagePreview.value);
  imagePreview.value = "";
}
function edit(article?: Article) {
  clearPreview();
  editing.value = false;
  htmlMode.value = false;
  const parsed = article ? articleSchema.parse(article) : empty();
  editId.value = article?.id || "";
  slugManuallyEdited.value = !!article;
  Object.assign(form, {
    ...parsed,
    published: article
      ? article.published || !!article.publishedAt
      : parsed.published,
    publishedAt: toDateTimeLocal(parsed.publishedAt),
  });
  currentImage.value = article?.image || "";
  imageFile.value = undefined;
  removeImage.value = false;
  editing.value = true;
  notice.value = "";
  preview.value = false;
}
function toDateTimeLocal(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function toIsoDateTime(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
function togglePublished() {
  if (!form.published) form.publishedAt = "";
}
function articleStatus(article: Article) {
  if (article.published) return "Опубликована";
  if (article.publishedAt)
    return `Запланирована · ${new Date(article.publishedAt).toLocaleString("ru-RU")}`;
  return "Черновик";
}
function selectImage(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (
    file.size > 10 * 1024 * 1024 ||
    !["image/jpeg", "image/png", "image/webp"].includes(file.type)
  ) {
    notice.value = "Допустимы JPEG, PNG и WebP до 10 МБ.";
    return;
  }
  clearPreview();
  imageFile.value = file;
  imagePreview.value = URL.createObjectURL(file);
  removeImage.value = false;
}
function clearImage() {
  clearPreview();
  imageFile.value = undefined;
  currentImage.value = "";
  removeImage.value = true;
}
onBeforeUnmount(clearPreview);
async function save() {
  const parsed = articleSchema.safeParse({
    ...form,
    publishedAt: toIsoDateTime(form.publishedAt),
  });
  if (!parsed.success) {
    notice.value =
      "Проверьте поля: заголовок от 3 символов, анонс от 10, текст от 30. Адрес — латиница, цифры и дефисы.";
    return;
  }
  pending.value = true;
  try {
    const article = await $fetch<Article>(
      "/api/admin/articles" + (editId.value ? "/" + editId.value : ""),
      { method: editId.value ? "PUT" : "POST", body: parsed.data },
    );
    try {
      if (imageFile.value) {
        const body = new FormData();
        body.append("file", imageFile.value);
        await $fetch(`/api/admin/articles/${article.id}/image`, {
          method: "POST",
          body,
        });
      } else if (removeImage.value && article.image) {
        await $fetch(`/api/admin/articles/${article.id}/image`, {
          method: "DELETE",
        });
      }
    } catch {
      await refresh();
      notice.value =
        "Статья сохранена, но обложка не загрузилась. Откройте статью и попробуйте ещё раз.";
      return;
    }
    await refresh();
    clearPreview();
    editing.value = false;
    notice.value = "Статья сохранена.";
  } catch (error: any) {
    notice.value =
      error.status === 409
        ? "Этот адрес уже занят другой статьёй."
        : "Не удалось сохранить статью. Попробуйте ещё раз.";
  } finally {
    pending.value = false;
  }
}
async function remove(article: Article) {
  if (
    !confirm(`Удалить статью «${article.title}»? Это действие нельзя отменить.`)
  )
    return;
  try {
    await $fetch("/api/admin/articles/" + article.id, { method: "DELETE" });
    await refresh();
    notice.value = "Статья удалена.";
  } catch {
    notice.value = "Не удалось удалить статью.";
  }
}
</script>
<template>
  <div>
    <h1 class="admin-title">Блог · статьи</h1>
    <p v-if="notice" role="status" class="toast">{{ notice }}</p>
    <p v-if="error" class="error-text">Не удалось загрузить статьи.</p>
    <template v-if="editing"
      ><form class="article-editor" @submit.prevent="save">
        <label
          >Заголовок статьи<input
            v-model="form.title"
            required
            minlength="3"
            maxlength="150" /></label
        ><label
          >Адрес статьи<input
            v-model="form.slug"
            @input="slugManuallyEdited = true"
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxlength="150"
            placeholder="kak-vybrat-novostroyku"
          /><small>/blog/{{ form.slug }}</small></label
        ><label
          >Краткий анонс<textarea
            ref="excerptField"
            v-model="form.excerpt"
            class="auto-resize"
            required
            minlength="10"
            maxlength="400"
            rows="3"
          />
        </label>
        <div
          class="article-content-editor"
          role="group"
          aria-labelledby="article-content-label"
          aria-describedby="article-format"
        >
          <span id="article-content-label" class="article-content-label">
            Текст статьи
          </span>
          <ClientOnly>
            <ArticleRichTextEditor
              v-model="form.content"
              v-model:html-mode="htmlMode"
              :disabled="pending"
              aria-label="Текст статьи"
            />
            <template #fallback>
              <div class="article-content-loading">Редактор загружается…</div>
            </template>
          </ClientOnly>
          <p id="article-format">
            Используйте панель редактора для подзаголовков, выделений, списков,
            цитат и ссылок.
          </p>
        </div>
        <div class="article-image-field">
          <p class="article-image-label">Обложка статьи</p>
          <label class="article-image-picker"
            ><input
              class="article-image-input"
              type="file"
              aria-label="Обложка статьи"
              accept="image/jpeg,image/png,image/webp"
              @change="selectImage"
            /><span class="btn-secondary">Выбрать фото</span
            ><span class="article-image-name">{{
              imageFile?.name ||
              (currentImage ? "Обложка загружена" : "Файл не выбран")
            }}</span></label
          >
          <p class="article-image-hint">JPEG, PNG или WebP · до 10 МБ. Фото появится в обложке и на странице статьи.</p>
          <label
            >SEO-название фото<input
              v-model="form.imageAlt"
              maxlength="250"
              placeholder="Кратко опишите, что изображено на фото"
          /></label>
          <div
            v-if="imagePreview || currentImage"
            class="article-image-preview"
          >
            <img
              :src="imagePreview || currentImage"
              :alt="form.imageAlt || form.title || 'Обложка статьи'"
              :title="form.imageAlt || undefined"
            /><button type="button" class="btn-secondary" @click="clearImage">
              Удалить обложку
            </button>
          </div>
        </div>
        <details>
          <summary>SEO-настройки</summary>
          <label
            >SEO-заголовок<input
              v-model="form.seoTitle"
              maxlength="150"
              placeholder="По умолчанию — заголовок статьи" /></label
          ><label
            >SEO-описание<textarea
              ref="seoDescriptionField"
              v-model="form.seoDescription"
              class="auto-resize"
              maxlength="300"
              rows="3"
              placeholder="По умолчанию — краткий анонс"
            />
          </label>
          <label
            >Ключевые слова страницы<textarea
              ref="seoKeywordsField"
              v-model="form.seoKeywords"
              class="auto-resize"
              maxlength="1000"
              rows="2"
              placeholder="Например: новостройки Калининграда, покупка квартиры"
            /><small>Перечислите слова и фразы через запятую.</small>
          </label>
        </details>
        <label class="article-publish"
          ><input
            v-model="form.published"
            type="checkbox"
            @change="togglePublished"
          /><span
            ><strong>Опубликовать статью</strong></span
          ></label
        >
        <label v-if="form.published"
          >Дата и время публикации<input
            v-model="form.publishedAt"
            type="datetime-local"
          /><small
            >Время указано по часовому поясу браузера. Оставьте поле пустым для
            немедленной публикации.</small
          ></label
        >
        <div class="article-actions">
          <Button :disabled="pending" type="submit">
            {{ pending ? "Сохраняем…" : "Сохранить статью" }}</Button
          ><button
            type="button"
            class="btn-secondary"
            @click="preview = !preview"
          >
            Предпросмотр</button
          ><button
            type="button"
            class="btn-secondary"
            :disabled="pending"
            @click="editing = false"
          >
            Отмена
          </button>
        </div>
      </form>
      <section v-if="preview" class="article-preview">
        <img
          v-if="imagePreview || currentImage"
          :src="imagePreview || currentImage"
          :alt="form.imageAlt || form.title || 'Обложка статьи'"
          :title="form.imageAlt || undefined"
        />
        <h2>{{ form.title || "Заголовок статьи" }}</h2>
        <p>{{ form.excerpt }}</p>
        <template v-if="htmlMode">
          <p class="article-preview-source-note">
            Вы редактируете HTML. Переключитесь в визуальный режим, чтобы
            увидеть форматированный предпросмотр.
          </p>
          <pre class="article-preview-source">{{ form.content }}</pre>
        </template>
        <ArticleBody v-else :content="form.content" /></section
    ></template>
    <template v-else
      ><Button class="mb-6" @click="edit()">Новая статья</Button>
      <AdminExclusionFilters
        v-model="exclusions"
        :fields="exclusionFields"
        class="admin-panel mb-6"
        text-hint="Заголовок, адрес, анонс или текст статьи."
      />
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Статья</th>
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="article in filtered" :key="article.id">
              <td>
                {{ article.title }}<small>/blog/{{ article.slug }}</small>
              </td>
              <td>{{ articleStatus(article) }}</td>
              <td>
                <div class="article-actions">
                  <button class="btn-secondary" @click="edit(article)">
                    Редактировать</button
                  ><NuxtLink
                    v-if="article.published"
                    :to="'/blog/' + article.slug"
                    class="btn-secondary"
                    >Открыть</NuxtLink
                  ><button class="btn-secondary" @click="remove(article)">
                    Удалить
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="!filtered.length">
              <td colspan="3">{{ data?.length ? "По выбранным фильтрам статьи не найдены." : "Статей пока нет. Создайте первую публикацию." }}</td>
            </tr>
          </tbody>
        </table>
      </div></template
    >
  </div>
</template>
<style scoped>
.article-editor {
  display: grid;
  gap: 22px;
  max-width: 860px;
}
.article-editor small,
#article-format {
  color: #526473;
  line-height: 1.7;
}
.article-content-editor {
  display: grid;
  gap: 8px;
}
.article-content-label {
  color: #526473;
  font-size: 0.875rem;
  font-weight: 600;
}
.article-content-loading {
  min-height: 340px;
  align-content: center;
  border: 1px solid #cfdeea;
  border-radius: 8px;
  color: #526473;
  text-align: center;
}
.article-preview-source-note {
  color: #526473;
}
.article-preview-source {
  overflow: auto;
  padding: 16px;
  border: 1px solid #cfdeea;
  border-radius: 8px;
  background: #f9fbfe;
  white-space: pre-wrap;
}
.article-editor details {
  padding: 20px;
  border: 1px solid #cfdeea;
  border-radius: 8px;
}
.article-editor details label {
  margin-top: 18px;
}
.article-editor summary {
  cursor: pointer;
}
.article-editor textarea.auto-resize {
  resize: none;
  overflow: hidden;
}
.article-image-field {
  display: grid;
  gap: 10px;
}
.article-image-label {
  font-weight: 600;
}
.article-image-picker {
  display: flex;
  width: fit-content;
  max-width: 100%;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}
.article-image-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
}
.article-image-input:focus-visible + .btn-secondary {
  outline: 2px solid #0b76ff;
  outline-offset: 2px;
}
.article-image-name {
  min-width: 0;
  color: #526473;
  font-size: 0.875rem;
  overflow-wrap: anywhere;
}
.article-image-hint {
  color: #526473;
  font-size: 0.75rem;
}
.article-image-preview {
  display: grid;
  justify-items: start;
  gap: 12px;
}
.article-image-preview img,
.article-preview > img {
  width: 100%;
  max-height: 440px;
  object-fit: cover;
  border-radius: 12px;
}
.article-publish {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 18px;
  border: 1px solid #cfdeea;
  border-radius: 12px;
  background: white;
  cursor: pointer;
  transition:
    border-color 160ms,
    background-color 160ms;
}
.article-publish:has(input:checked) {
  border-color: #0b76ff;
  background: #edf5ff;
}
.article-publish input {
  width: 20px;
  height: 20px;
  margin-top: 1px;
}
.article-publish span {
  display: grid;
  gap: 3px;
}
.article-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.article-preview {
  max-width: 860px;
  margin-top: 32px;
  padding: 28px;
  background: white;
  border: 1px solid #cfdeea;
}
.article-preview > p {
  margin-top: 20px;
}
.article-preview > img {
  margin-bottom: 24px;
}
</style>
