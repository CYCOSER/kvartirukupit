<script setup lang="ts">
import { ArrowUpRight, ArrowDown, ArrowLeft, ArrowRight, MapPin } from "lucide-vue-next";
import {
  types,
  statuses,
  money,
  formatReadiness,
  propertyAddress,
  seaDistanceLabel,
  type Property,
} from "~/shared/property";
import { loopScroll } from "~/shared/carousel";
const route = useRoute();
const { data: p, error } = await useFetch<Property>(
  "/api/properties/" + route.params.slug,
);
if (!p.value)
  throw createError({
    statusCode: error.value?.statusCode || 404,
    statusMessage: "Объект не найден",
  });
const config = useRuntimeConfig();
const readiness = computed(() => formatReadiness(p.value!.readiness, p.value!.constructionStatus) || 'Уточняется');
const heroImage = computed(() => p.value?.images.find((image) => image.kind !== 'plan') || p.value?.images[0]);
const seaDistance = computed(() =>
  p.value ? seaDistanceLabel(p.value) : null,
);
const priceCaption = computed(() =>
  p.value?.type === "complex" &&
  p.value.price !== null &&
  ["from", "minimum"].includes(p.value.priceKind || "")
    ? "Квартиры от"
    : "Стоимость",
);
const active = ref(0);
const gallery = ref<HTMLElement>();
const lightbox = ref<HTMLDialogElement>();
const lightboxIndex = ref(0);
const multiplePhotos = computed(() => (p.value?.images.length || 0) > 1);
const photoCopies = computed(() => (multiplePhotos.value ? [0, 1, 2] : [1]));
const photoRatios = ref<Record<string, number>>({});
let photoCenters: number[] = [];
let galleryResize: ResizeObserver | undefined;
let settleTimer: ReturnType<typeof setTimeout> | undefined;

function setPhotoRatio(image: HTMLImageElement, id: string) {
  if (image.naturalHeight) photoRatios.value[id] = image.naturalWidth / image.naturalHeight;
}
function measurePhotoCenters() {
  const rail = gallery.value!;
  const left = rail.getBoundingClientRect().left;
  photoCenters = Array.from(rail.querySelectorAll<HTMLElement>(".gallery-main"), (photo) => {
    const rect = photo.getBoundingClientRect();
    return rect.left - left + rail.scrollLeft + (rect.width - rail.clientWidth) / 2;
  });
}
function nearestPhoto() {
  const left = gallery.value!.scrollLeft;
  return photoCenters.reduce((nearest, center, index) =>
    Math.abs(center - left) < Math.abs(photoCenters[nearest] - left) ? index : nearest, 0);
}
function settleGallery() {
  if (!gallery.value || !multiplePhotos.value || !photoCenters.length) return;
  measurePhotoCenters();
  const start = photoCenters[p.value!.images.length];
  const cycle = start - photoCenters[0];
  const left = gallery.value.scrollLeft;
  if (left < start - 1 || left >= start + cycle - 1)
    gallery.value.scrollTo({
      left: loopScroll(left - photoCenters[0], cycle) + photoCenters[0],
      behavior: "instant",
    });
}
function onGalleryScroll() {
  if (!gallery.value || !photoCenters.length) return;
  // Image loads can move scroll-snap before ResizeObserver delivers the new sizes.
  measurePhotoCenters();
  const nextActive = nearestPhoto() % p.value!.images.length;
  if (nextActive !== active.value && gallery.value.contains(document.activeElement))
    gallery.value.focus({ preventScroll: true });
  active.value = nextActive;
  clearTimeout(settleTimer);
  settleTimer = setTimeout(settleGallery, 160);
}
function showPhoto(index: number) {
  if (!gallery.value || !multiplePhotos.value || !photoCenters.length) return;
  settleGallery();
  gallery.value.scrollTo({
    left: photoCenters[p.value!.images.length + index],
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
  });
}
function advancePhoto(direction: number) {
  if (!gallery.value || !photoCenters.length) return;
  settleGallery();
  showPhoto(
    nearestPhoto() - p.value!.images.length + direction,
  );
}
function openPhoto(index: number) {
  lightboxIndex.value = index;
  lightbox.value?.showModal();
}
function stepLightbox(direction: number) {
  lightboxIndex.value =
    (lightboxIndex.value + direction + p.value!.images.length) %
    p.value!.images.length;
}
function closeOnBackdrop(event: MouseEvent) {
  if (event.target === lightbox.value) lightbox.value.close();
}
function onLightboxClose() {
  showPhoto(lightboxIndex.value);
  gallery.value?.focus({ preventScroll: true });
}
onMounted(() => {
  if (!gallery.value) return;
  gallery.value.closest(".detail-gallery")?.querySelectorAll<HTMLImageElement>("img[data-photo-id]")
    .forEach((image) => setPhotoRatio(image, image.dataset.photoId!));
  galleryResize = new ResizeObserver(() => {
    measurePhotoCenters();
    if (!photoCenters.length) return;
    gallery.value!.scrollTo({
      left: multiplePhotos.value
        ? photoCenters[p.value!.images.length + active.value]
        : 0,
      behavior: "instant",
    });
  });
  galleryResize.observe(gallery.value);
  gallery.value.querySelectorAll(".gallery-main").forEach((photo) => galleryResize!.observe(photo));
});
onBeforeUnmount(() => {
  galleryResize?.disconnect();
  clearTimeout(settleTimer);
});
usePageSeo(
  p.value.title,
  [types[p.value.type], propertyAddress(p.value), readiness.value]
    .filter(Boolean)
    .join(". "),
);
useHead({
  script: [
    {
      type: "application/ld+json",
      innerHTML: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        name: p.value.title,
        description: p.value.description,
        image: p.value.images.map(
          (i) => new URL(i.file, config.public.siteUrl).href,
        ),
        ...(p.value.price === null || p.value.priceKind === "example"
          ? {}
          : {
              offers: {
                "@type": "Offer",
                price: p.value.price,
                priceCurrency: "RUB",
                availability:
                  p.value.status === "available"
                    ? "https://schema.org/InStock"
                    : "https://schema.org/OutOfStock",
                url: config.public.siteUrl + route.path,
              },
            }),
      }).replace(/</g, "\\u003c"),
    },
  ],
});
</script>
<template>
  <div v-if="p" class="property-page">
    <SceneHero
      class="detail-hero"
      :class="{ 'is-plan': heroImage?.kind === 'plan' }"
      :image="heroImage?.file"
      :alt="heroImage?.alt || ''"
    >
      <nav class="breadcrumb" aria-label="Хлебные крошки">
        <NuxtLink to="/">Главная</NuxtLink><span aria-hidden="true">/</span
        ><NuxtLink :to="p.elite ? '/elite' : '/catalog'">{{ p.elite ? "Элитные квартиры" : "Новостройки" }}</NuxtLink
        ><span aria-hidden="true">/</span
        ><span aria-current="page">Объект</span>
      </nav>
      <p class="eyebrow">{{ p.location }}</p>
      <h1 class="detail-title">{{ p.title }}</h1>
      <p class="detail-hero-script" :class="{ 'is-complex-name': p.type === 'apartment' && p.complex }">
        {{ p.type === 'apartment' && p.complex ? 'ЖК ' + p.complex.title.replace(/^ЖК\s+/i, '') : types[p.type] }}
      </p>
      <p v-if="seaDistance" class="detail-hero-location">{{ seaDistance }}</p>
      <a
        :href="p.status === 'sold' ? '#about-property' : '#property-enquiry'"
        class="detail-hero-cta"
        >{{
          p.status === "sold" ? "Узнать о комплексе" : "Записаться на просмотр"
        }}
        <ArrowDown :size="20" aria-hidden="true"
      /></a>
      <template #aside>
        <small
          >{{ p.type === "complex" ? "Жилой комплекс" : statuses[p.status] }} /
          {{ priceCaption }}</small
        >
        <strong class="detail-hero-price">{{ money(p.price) }}</strong>
        <p>{{ readiness }}</p>
      </template>
    </SceneHero>
    <section class="detail-gallery" aria-labelledby="detail-gallery-title">
      <div class="detail-gallery-heading shell">
        <div>
          <p class="eyebrow">01 / ФОТОГРАФИИ</p>
          <h2 id="detail-gallery-title" class="type-pair">
            <span class="type-upright">Увидеть комплекс</span>
            <em class="type-script">В деталях</em>
          </h2>
        </div>
        <div class="detail-gallery-aside">
          <p class="detail-gallery-count">
            <strong>{{ String(p.images.length).padStart(2, "0") }}</strong>
            <span>Фото в галерее</span>
          </p>
          <p class="detail-gallery-place">
            {{ p.location
            }}<template v-if="seaDistance"><br />{{ seaDistance }}</template>
          </p>
          <NuxtLink
            class="detail-gallery-action"
            data-testid="property-map-link"
            :to="{ path: p.elite ? '/elite' : '/catalog', query: { view: 'map', type: p.type, status: p.status, property: p.id }, hash: '#homes' }"
          ><MapPin :size="18" aria-hidden="true" /><span>Посмотреть на карте</span></NuxtLink>
        </div>
      </div>
      <figure class="detail-gallery-figure">
        <div
          v-if="p.images.length"
          class="gallery-carousel"
          role="region"
          aria-roledescription="карусель"
          aria-label="Фотографии жилого комплекса"
          @keydown.left.prevent="advancePhoto(-1)"
          @keydown.right.prevent="advancePhoto(1)"
        >
          <div
            ref="gallery"
            class="gallery-rail"
            tabindex="0"
            :aria-label="
              multiplePhotos
                ? 'Листайте фотографии стрелками или свайпом'
                : 'Фотография жилого комплекса'
            "
            @scroll.passive="onGalleryScroll"
            @scrollend="settleGallery"
          >
            <div class="gallery-track shell" :class="{ 'is-single': !multiplePhotos }">
              <template v-for="copy in photoCopies" :key="copy">
                <button
                  v-for="(img, i) in p.images"
                  :key="`${copy}-${img.id}`"
                  type="button"
                  :aria-label="`Открыть фото ${i + 1} в увеличенном формате`"
                  :aria-hidden="copy !== 1 || i !== active"
                  :tabindex="copy === 1 && i === active ? 0 : -1"
                  class="gallery-main"
                  :style="{ aspectRatio: photoRatios[img.id] || 1000 / 667 }"
                  @click="openPhoto(i)"
                >
                  <img
                    :src="img.file"
                    :data-photo-id="img.id"
                    :class="{ 'is-plan': img.kind === 'plan' }"
                    alt=""
                    width="1000"
                    height="667"
                    loading="lazy"
                    draggable="false"
                    @load="setPhotoRatio($event.target as HTMLImageElement, img.id)"
                  />
                </button>
              </template>
            </div>
          </div>
          <div v-if="multiplePhotos" class="gallery-controls shell">
            <button
              type="button"
              class="gallery-arrow"
              aria-label="Предыдущее фото"
              @click="advancePhoto(-1)"
            >
              <ArrowLeft :size="18" :stroke-width="1.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="gallery-arrow"
              aria-label="Следующее фото"
              @click="advancePhoto(1)"
            >
              <ArrowRight :size="18" :stroke-width="1.5" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div v-else class="shell">
          <div class="gallery-empty">Фотографии пока не добавлены</div>
        </div>
        <figcaption class="detail-gallery-caption shell">
          <span v-if="p.demo"
            >Демонстрационный объект · иллюстративные фото</span
          >
          <span v-else>{{ p.location }} · {{ types[p.type] }}</span>
          <span
            v-if="p.images.length"
            class="detail-image-count"
            aria-live="polite"
            aria-atomic="true"
            >{{ String(active + 1).padStart(2, "0") }} /
            {{ String(p.images.length).padStart(2, "0") }}</span
          >
        </figcaption>
      </figure>
      <div
        v-if="p.images.length > 1"
        class="gallery-thumbs shell"
        role="group"
        aria-label="Фотографии объекта"
      >
        <button
          v-for="(img, i) in p.images"
          :key="img.id"
          type="button"
          :class="{ active: i === active }"
          :aria-label="'Показать фото ' + (i + 1)"
          :aria-pressed="i === active"
          @click="showPhoto(i)"
        >
          <img :src="img.file" :data-photo-id="img.id" :alt="img.alt" :class="{ 'is-plan': img.kind === 'plan' }" @load="setPhotoRatio($event.target as HTMLImageElement, img.id)" />
        </button>
      </div>
      <dialog
        v-if="p.images.length"
        ref="lightbox"
        class="gallery-lightbox"
        aria-label="Просмотр фотографий жилого комплекса"
        @click="closeOnBackdrop"
        @keydown.left.prevent="stepLightbox(-1)"
        @keydown.right.prevent="stepLightbox(1)"
        @close="onLightboxClose"
      >
        <button
          type="button"
          class="lightbox-close"
          aria-label="Закрыть фото"
          @click="lightbox?.close()"
        >
          ×
        </button>
        <img
          :src="p.images[lightboxIndex]?.file"
          :alt="p.images[lightboxIndex]?.alt"
        />
        <div v-if="multiplePhotos" class="lightbox-controls">
          <button
            type="button"
            aria-label="Предыдущее увеличенное фото"
            @click="stepLightbox(-1)"
          >
            <ArrowLeft :size="26" :stroke-width="1.5" aria-hidden="true" />
          </button>
          <span>{{ lightboxIndex + 1 }} / {{ p.images.length }}</span>
          <button
            type="button"
            aria-label="Следующее увеличенное фото"
            @click="stepLightbox(1)"
          >
            <ArrowRight :size="26" :stroke-width="1.5" aria-hidden="true" />
          </button>
        </div>
      </dialog>
      <dl class="detail-specs shell">
        <div v-if="p.area != null">
          <dt>Площадь квартиры</dt>
          <dd>{{ p.area }} <span>м²</span></dd>
        </div>
        <div v-if="p.bedrooms != null">
          <dt>Комнаты</dt>
          <dd>{{ p.bedrooms }}</dd>
        </div>
        <div v-if="p.floors != null">
          <dt>Этажность</dt>
          <dd>{{ p.floors }}</dd>
        </div>
        <div v-if="p.constructionStatus" class="detail-spec-text">
          <dt>Строительство</dt>
          <dd>{{ p.constructionStatus }}</dd>
        </div>
        <div v-if="p.district" class="detail-spec-text">
          <dt>Район</dt>
          <dd>{{ p.district }}</dd>
        </div>
      </dl>
    </section>
    <section id="about-property" class="shell detail-story">
      <div class="detail-text">
        <p class="eyebrow">02 / О ДОМЕ</p>
        <h2 class="type-pair">
          <span class="type-upright">О жилом комплексе</span>
          <em class="type-script">Для вашей жизни</em>
        </h2>
        <p class="detail-description">{{ p.description }}</p>
        <NuxtLink v-if="p.type === 'apartment' && p.complex" :to="'/catalog/' + p.complex.slug" class="detail-parent-link">
          Подробнее о ЖК «{{ p.complex.title.replace(/^ЖК\s+/i, '') }}» <ArrowUpRight :size="17" aria-hidden="true" />
        </NuxtLink>
      </div>
      <div class="detail-attributes">
        <div>
          <h3>Готовность и отделка</h3>
          <dl>
            <div v-if="p.developer">
              <dt>Застройщик</dt>
              <dd>{{ p.developer }}</dd>
            </div>
            <div v-if="p.address">
              <dt>Адрес</dt>
              <dd>{{ propertyAddress(p) }}</dd>
            </div>
            <div>
              <dt>Готовность</dt>
              <dd>{{ readiness }}</dd>
            </div>
            <div>
              <dt>Отделка</dt>
              <dd>{{ p.finish }}</dd>
            </div>
          </dl>
        </div>
        <div>
          <h3>Коммуникации и удобства</h3>
          <div v-if="p.utilities.length" class="utilities">
            <span v-for="item in p.utilities" :key="item">{{ item }}</span>
          </div>
          <p v-else>Уточним оснащение дома и благоустройство двора при обращении.</p>
        </div>
      </div>
    </section>
    <section v-if="p.type === 'complex' && p.apartments?.length" class="shell detail-apartments" aria-labelledby="complex-apartments-title">
      <h2 id="complex-apartments-title">Квартиры в этом ЖК</h2>
      <div class="detail-apartments-grid">
        <NuxtLink v-for="apartment in p.apartments" :key="apartment.id" :to="'/catalog/' + apartment.slug" class="detail-apartment">
          <img v-if="apartment.images[0]" :src="apartment.images[0].file" :alt="apartment.images[0].alt" width="400" height="280" loading="lazy" :class="{ 'is-plan': apartment.images[0].kind === 'plan' }" />
          <div class="detail-apartment-body">
            <span class="detail-apartment-status">{{ statuses[apartment.status] }}</span>
            <h3>{{ apartment.title }}</h3>
            <p><span v-if="apartment.area != null">{{ apartment.area }} м²</span><span v-if="apartment.bedrooms != null">{{ apartment.bedrooms === 0 ? 'Студия' : apartment.bedrooms + '-комнатная' }}</span></p>
            <strong>{{ money(apartment.price) }}</strong>
            <span class="detail-apartment-link">Подробнее о квартире <ArrowUpRight :size="17" aria-hidden="true" /></span>
          </div>
        </NuxtLink>
      </div>
    </section>
    <section v-if="p.status !== 'sold'" class="detail-finance">
      <div class="shell"><MortgageCalculator :price="p.price" /></div>
    </section>
    <section
      id="property-enquiry"
      class="detail-enquiry"
      :class="{ 'is-sold': p.status === 'sold' }"
    >
      <div class="shell detail-enquiry-grid">
        <div class="detail-enquiry-story">
          <p class="eyebrow">
            {{
              p.status === "sold"
                ? "03 / ДРУГИЕ КВАРТИРЫ"
                : "03 / ЛИЧНЫЙ ПРОСМОТР"
            }}
          </p>
          <h2 class="type-pair">
            <span class="type-upright">{{
              p.status === "sold" ? "Продажи завершены" : "Увидимся?"
            }}</span>
            <em class="type-script">{{
              p.status === "sold" ? "Найдём вашу" : "В новом квартале"
            }}</em>
          </h2>
          <p>
            {{
              p.status === "sold"
                ? "Продажи в этом комплексе завершены. Посмотрите другие новостройки Калининграда."
                : "Обсудим планировку, окружение и ваши пожелания. Оставьте контакты, чтобы согласовать личный просмотр."
            }}
          </p>
          <div v-if="p.status !== 'sold'" class="detail-viewing-topics">
            <p>На просмотре</p>
            <ol>
              <li>
                <span aria-hidden="true">01</span>
                <div>
                  <h3>Планировка и детали</h3>
                  <p>Планировка, материалы и отделка</p>
                </div>
              </li>
              <li>
                <span aria-hidden="true">02</span>
                <div>
                  <h3>Двор и окружение</h3>
                  <p>Благоустройство, транспорт и инфраструктура рядом</p>
                </div>
              </li>
              <li>
                <span aria-hidden="true">03</span>
                <div>
                  <h3>Вопросы перед покупкой</h3>
                  <p>Документы, готовность и условия покупки</p>
                </div>
              </li>
            </ol>
          </div>
          <div v-if="p.status !== 'sold'" class="detail-enquiry-place">
            <img
              v-if="p.images[0]"
              :src="p.images[0].file"
              :class="{ 'is-plan': p.images[0].kind === 'plan' }"
              alt=""
              width="96"
              height="96"
              loading="lazy"
            />
            <div>
              <span>Ваш личный просмотр</span>
              <strong>{{ p.title }}</strong>
              <span
              >{{ propertyAddress(p)
                }}<template v-if="p.area != null"> · {{ p.area }} м²</template
                ><template v-if="seaDistance">
                  · {{ seaDistance }}</template
                ></span
              >
            </div>
          </div>
          <NuxtLink
            v-if="p.status === 'sold'"
            class="detail-hero-cta"
            :to="p.elite ? '/elite' : '/catalog'"
            >Выбрать другую квартиру
            <ArrowUpRight :size="20" aria-hidden="true"
          /></NuxtLink>
        </div>
        <LeadForm v-if="p.status !== 'sold'" :property-id="p.id" />
      </div>
    </section>
  </div>
</template>
<style scoped>
.property-page {
  overflow-anchor: none;
}
.detail-parent-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  text-decoration: underline;
  text-underline-offset: 4px;
}
.detail-apartments { padding-bottom: 64px; }
.detail-apartments h2 { margin-bottom: 28px; font-size: clamp(28px, 3vw, 42px); }
.detail-apartments-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 24px; }
.detail-apartment { display: flex; flex-direction: column; border: 1px solid #bbc8da; }
.detail-apartment > img { width: 100%; aspect-ratio: 1.43; object-fit: cover; background: white; }
.detail-apartment > img.is-plan { object-fit: contain; padding: 12px; }
.detail-apartment-body { display: grid; align-content: start; gap: 14px; padding: 24px; }
.detail-apartment h3 { font-size: 22px; line-height: 1.3; }
.detail-apartment-status { color: #527097; font-size: 13px; }
.detail-apartment p { display: flex; flex-wrap: wrap; gap: 16px; color: #455e7f; }
.detail-apartment strong { font-size: 22px; }
.detail-apartment-link { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 14px; }
.detail-apartment:hover, .detail-apartment:focus-visible { border-color: #245fae; }
.detail-hero {
  min-height: max(650px, 80svh);
}
.detail-hero :deep(.scene-shade) {
  background: linear-gradient(90deg, #0c1b2eda, #0c1b2e83 65%, #0c1b2e45);
}
.detail-hero.is-plan :deep(.scene-photo) {
  position: absolute;
  object-fit: contain;
  background: #fff;
}
.detail-hero :deep(.scene-panel .detail-title) {
  margin: 24px 0 0;
  font-size: clamp(48px, 5.8vw, 84px);
  line-height: 1.1;
  letter-spacing: 0.015em;
  text-transform: uppercase;
  overflow-wrap: anywhere;
}
.detail-hero :deep(.scene-panel .detail-hero-script) {
  position: relative;
  z-index: 1;
  max-width: calc(100% - 0.35em);
  width: fit-content;
  margin: -0.2em 0 0 0.35em;
  font-family: var(--font-script);
  font-size: clamp(38px, 5.2vw, 76px);
  font-weight: 400;
  line-height: 1;
  color: #ccd6e3;
}
.detail-hero :deep(.scene-panel .detail-hero-location) {
  margin-top: 22px;
  color: #d6e1ef;
}
.detail-hero :deep(.scene-panel .detail-hero-script.is-complex-name) {
  overflow-wrap: anywhere;
}
.detail-hero-cta {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  width: fit-content;
  margin-top: 28px;
  padding: 12px 0;
  border-bottom: 1px solid #ccd6e3;
  color: #f2f6fb;
  font-size: 14px;
  font-weight: 600;
}
.detail-hero-cta svg {
  transition: transform 220ms ease;
}
.detail-hero-cta:hover svg {
  transform: translate(3px, -3px);
}
.detail-hero-cta[href^="#"]:hover svg {
  transform: translateY(3px);
}
.detail-hero :deep(.scene-aside .detail-hero-price) {
  font-family: var(--font-display);
  font-size: clamp(25px, 2.4vw, 37px);
  line-height: 1.25;
  letter-spacing: 0;
  color: #ccd6e3;
  overflow-wrap: anywhere;
}
.detail-gallery {
  padding-top: clamp(54px, 7vw, 92px);
  padding-bottom: 24px;
}
.detail-gallery-heading {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 260px);
  gap: clamp(32px, 5vw, 72px);
  margin-bottom: 16px;
}
.detail-gallery-heading .eyebrow,
.detail-story .eyebrow {
  color: #527097;
}
.detail-gallery h2 {
  font-size: clamp(44px, 5.5vw, 82px);
  margin-top: 16px;
}
.detail-gallery-aside {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  border-left: 1px solid #bbc8da;
  padding-left: 24px;
}
.detail-gallery-count {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0;
  color: #527097;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.detail-gallery-count strong {
  flex: none;
  color: #245fbd;
  font-family: var(--font-display);
  font-size: 48px;
  font-weight: 400;
  letter-spacing: 0;
  line-height: 1;
  white-space: nowrap;
}
.detail-gallery-place {
  margin: 16px 0 0;
  color: #245fbd;
  font-size: 14px;
  line-height: 1.6;
}
.detail-gallery-action {
  display: flex;
  align-items: center;
  align-self: stretch;
  gap: 12px;
  min-height: 50px;
  margin-top: 20px;
  padding: 12px 16px;
  border: 1px solid #183d65;
  border-radius: 8px;
  background: #183d65;
  color: #f5f8fc;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  text-decoration: none;
  overflow-wrap: normal;
  transition: background-color 180ms ease, border-color 180ms ease;
}
.detail-gallery-action svg { flex: none; }
.detail-gallery-action:hover { background: #244f7f; border-color: #244f7f; }
.detail-gallery-action:focus-visible { outline: 2px solid #245fae; outline-offset: 4px; }
.detail-gallery-figure {
  margin: 0;
}
.gallery-carousel {
  position: relative;
}
.gallery-rail {
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  scroll-snap-type: x mandatory;
  overscroll-behavior-x: contain;
}
.gallery-rail::-webkit-scrollbar {
  display: none;
}
.gallery-track {
  display: flex;
  gap: 12px;
  container-type: inline-size;
}
.gallery-track.is-single {
  justify-content: safe center;
}
.gallery-track .gallery-main {
  flex: 0 0 auto;
  min-width: 0;
  scroll-snap-align: center;
}
.gallery-controls {
  position: absolute;
  inset: 50% 0 auto;
  display: flex;
  justify-content: space-between;
  padding-inline: 16px;
  pointer-events: none;
  transform: translateY(-50%);
}
.gallery-arrow {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid #bdcadc;
  border-radius: 2px;
  background: #dde6f2;
  color: #163c66;
  pointer-events: auto;
  transition: opacity 180ms ease, background-color 180ms ease;
}
.gallery-arrow:hover {
  background: #bdcadc;
}
.gallery-arrow:focus-visible,
.gallery-rail:focus-visible {
  outline: 2px solid #163c66;
  outline-offset: -4px;
}
@media (hover: hover) and (pointer: fine) {
  .gallery-arrow {
    opacity: 0;
    pointer-events: none;
  }
  .gallery-carousel:hover .gallery-arrow,
  .gallery-carousel:focus-within .gallery-arrow {
    opacity: 1;
    pointer-events: auto;
  }
}
@media (any-pointer: coarse) {
  .gallery-arrow {
    width: 44px;
    height: 44px;
    opacity: 1;
    pointer-events: auto;
  }
}
@media (prefers-reduced-motion: reduce) {
  .gallery-arrow {
    transition: none;
  }
}
.property-page .gallery-main,
.gallery-empty {
  border-radius: 0;
  margin: 0;
}
.gallery-empty {
  width: 100%;
  aspect-ratio: calc(1.85 / .85);
}
.property-page .gallery-main {
  display: block;
  width: auto;
  height: calc(100cqw / 1.85 * .85);
  overflow: hidden;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: zoom-in;
}
.property-page .gallery-main img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.property-page .gallery-main img.is-plan,
.property-page .gallery-thumbs img.is-plan,
.property-page .detail-enquiry-place img.is-plan {
  object-fit: contain;
  background: #fff;
}
.gallery-lightbox {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100dvh;
  max-width: none;
  max-height: none;
  margin: 0;
  padding: 60px 24px 72px;
  border: 0;
  background: #0c1b2ef2;
  color: #f2f6fb;
}
.gallery-lightbox[open] {
  display: grid;
  place-items: center;
}
.gallery-lightbox::backdrop {
  background: transparent;
}
.gallery-lightbox > img {
  max-width: 100%;
  max-height: calc(100dvh - 132px);
  object-fit: contain;
}
.lightbox-close,
.lightbox-controls button {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid #bdcadc80;
  border-radius: 50%;
  background: #0c1b2e99;
  color: #f2f6fb;
}
.lightbox-close {
  position: absolute;
  top: 16px;
  right: 16px;
  font-size: 30px;
  line-height: 1;
}
.lightbox-controls {
  position: absolute;
  right: 16px;
  bottom: 16px;
  left: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.lightbox-close:hover,
.lightbox-controls button:hover {
  background: #245fbd;
}
.lightbox-close:focus-visible,
.lightbox-controls button:focus-visible,
.gallery-main:focus-visible {
  outline: 2px solid #bdcadc;
  outline-offset: 3px;
}
.gallery-empty {
  display: grid;
  place-items: center;
  background: #d0dded;
  color: #245fbd;
}
.detail-gallery-caption {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding-top: 14px;
  color: #4a668a;
  font-size: 11px;
  line-height: 1.5;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.detail-image-count {
  color: #245fbd;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.property-page .gallery-thumbs {
  display: flex;
  gap: 10px;
  margin: 20px auto 0;
  padding-bottom: 8px;
  overflow-x: auto;
  scrollbar-width: none;
  scroll-snap-type: x mandatory;
}
.property-page .gallery-thumbs::-webkit-scrollbar {
  display: none;
}
.property-page .gallery-thumbs button {
  flex: 0 0 112px;
  width: 112px;
  padding: 0 0 5px;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  opacity: 0.65;
  scroll-snap-align: start;
}
.property-page .gallery-thumbs button.active {
  border-color: #476184;
  opacity: 1;
}
.property-page .gallery-thumbs img {
  width: 100%;
  height: 75px;
  object-fit: cover;
}
.property-page .detail-specs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
  gap: 0;
  margin: 52px auto 0;
  padding: 0;
  border: 0;
  border-top: 1px solid #bbc8da;
  border-bottom: 1px solid #bbc8da;
  border-radius: 0;
  background: transparent;
}
.property-page .detail-specs > div {
  min-width: 0;
  container-type: inline-size;
  padding: 25px 18px 28px 0;
}
.property-page .detail-specs > div + div {
  padding-left: 24px;
  border-left: 1px solid #bbc8da;
}
.property-page .detail-specs dt {
  color: #527097;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.property-page .detail-specs dd {
  margin-top: 12px;
  color: #102f50;
  font-family: var(--font-display);
  font-size: clamp(29px, 3vw, 42px);
  font-weight: 400;
  line-height: 1.15;
  overflow-wrap: normal;
  word-break: normal;
}
.property-page .detail-specs .detail-spec-text dd { font-size: clamp(18px, 9cqw, 28px); }
.property-page .detail-specs dd span {
  font-family: var(--font-body);
  font-size: 0.45em;
  font-weight: 500;
  white-space: nowrap;
}
.detail-story {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
  gap: clamp(50px, 8vw, 130px);
  padding-top: 64px;
  padding-bottom: clamp(64px, 7vw, 100px);
}
.property-page .detail-text {
  min-width: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.property-page .detail-text h2 {
  margin: 20px 0 0;
  font-size: clamp(38px, 4vw, 58px);
  line-height: 1.15;
  letter-spacing: 0;
}
.property-page .detail-text .detail-description {
  max-width: 65ch;
  margin-top: 26px;
  color: #455e7f;
  font-size: 15px;
  line-height: 1.95;
  white-space: pre-line;
}
.detail-attributes {
  min-width: 0;
  padding-top: 6px;
}
.detail-attributes > div {
  padding: 0 0 30px;
  border-top: 1px solid #bbc8da;
}
.detail-attributes > div + div {
  padding-top: 28px;
}
.detail-attributes h3 {
  margin-top: 22px;
  color: #102f50;
  font-family: var(--font-display);
  font-size: clamp(24px, 2.5vw, 33px);
  font-weight: 400;
  line-height: 1.2;
}
.detail-attributes dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
  margin-top: 26px;
}
.detail-attributes dt {
  color: #527097;
  font-size: 12px;
}
.detail-attributes dd,
.detail-attributes > div > p {
  margin-top: 6px;
  color: #3a506c;
  font-size: 14px;
  line-height: 1.7;
}
.property-page .utilities {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 20px;
  margin: 22px 0 0;
}
.property-page .utilities span {
  padding: 12px 0;
  border-top: 1px solid #bbc8da;
  border-radius: 0;
  background: transparent;
  color: #3a506c;
  line-height: 1.6;
}
.detail-finance {
  padding: clamp(40px, 6vw, 78px) 0;
  background: #1a3a64;
}
.detail-finance :deep(.mortgage) {
  margin: 0;
  border: 0;
  border-radius: 0;
  background: #ebf1f8;
  padding: clamp(26px, 4vw, 48px);
}
.detail-finance :deep(.mortgage h2) {
  font-size: clamp(27px, 3vw, 42px);
}
.detail-finance :deep(.mortgage-result),
.detail-finance :deep(.mortgage-icon) {
  border-radius: 0;
}
.detail-enquiry {
  position: relative;
  isolation: isolate;
  padding: clamp(64px, 8vw, 106px) 0;
  background: #102f50;
  color: #f2f6fb;
}
.detail-enquiry::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    linear-gradient(90deg, #0c1b2eef, #0c1b2eb5),
    url("/images/backgrounds/property-visit.webp") center / cover;
  background-attachment: fixed;
}
.detail-enquiry-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 0.95fr);
  gap: clamp(36px, 7vw, 100px);
  align-items: stretch;
}
.detail-enquiry.is-sold .detail-enquiry-grid {
  grid-template-columns: 1fr;
}
.detail-enquiry-story {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding-top: 8px;
}
.detail-enquiry-story .eyebrow {
  color: #a9bad1;
}
.detail-enquiry-story h2 {
  --script-color: #ccd6e3;
  margin-top: 24px;
  font-size: clamp(36px, 3.8vw, 58px);
}
.detail-enquiry-story > p:last-of-type {
  max-width: 500px;
  margin-top: 28px;
  color: #d6e1ef;
  font-size: 15px;
  line-height: 1.85;
}
.detail-enquiry-place {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-top: auto;
  padding-top: 28px;
}
.detail-enquiry-place img {
  flex: 0 0 88px;
  width: 88px;
  height: 96px;
  object-fit: cover;
}
.detail-enquiry-place > div {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.detail-viewing-topics {
  margin: 32px 0 0;
}
.detail-viewing-topics > p {
  margin: 0 0 12px;
  color: #a9bad1;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.detail-viewing-topics li {
  display: flex;
  gap: 20px;
  padding: 16px 0;
  border-top: 1px solid #d6e1ef30;
}
.detail-viewing-topics li > span {
  padding-top: 2px;
  color: #a9bad1;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.detail-viewing-topics h3 {
  margin: 0;
  font-family: var(--font-body);
  font-size: 15px;
  font-weight: 500;
  line-height: 1.4;
}
.detail-viewing-topics li p {
  margin: 5px 0 0;
  color: #b6c4d7;
  font-size: 12px;
  line-height: 1.6;
}
.detail-enquiry-place span:first-child {
  color: #a9bad1;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.detail-enquiry-place strong {
  font-family: var(--font-display);
  font-size: clamp(23px, 2.3vw, 32px);
  font-weight: 400;
  line-height: 1.2;
  overflow-wrap: anywhere;
}
.detail-enquiry-place span:last-child {
  color: #d6e1ef;
  font-size: 13px;
}
@media (max-width: 800px) {
  .detail-hero {
    min-height: 0;
  }
  .detail-story,
  .detail-enquiry-grid {
    grid-template-columns: 1fr;
    gap: 40px;
  }
  .detail-gallery-heading {
    grid-template-columns: minmax(0, 1fr) minmax(190px, 220px);
    gap: 24px;
  }
  .detail-gallery h2 {
    font-size: clamp(38px, 5.5vw, 54px);
  }
  .detail-enquiry-place {
    margin-top: 8px;
  }
}
@media (min-width: 541px) and (max-width: 800px) {
  .detail-hero :deep(.scene-grid) {
    grid-template-columns: minmax(0, 1fr) clamp(150px, 24vw, 190px);
    gap: 24px;
  }
  .detail-hero :deep(.scene-aside) {
    justify-self: stretch;
    max-width: none;
    border-top: 0;
    border-left: 1px solid #ffffff38;
    padding: 0 0 6px 20px;
  }
  .detail-hero :deep(.scene-panel .detail-title) {
    font-size: clamp(30px, 5.8vw, 48px);
  }
}
@media (max-width: 540px) {
  .detail-hero :deep(.scene-panel .detail-title) {
    font-size: clamp(27px, 7.7vw, 42px);
  }
  .detail-hero :deep(.scene-panel .detail-hero-script) {
    margin-left: 0.15em;
    font-size: clamp(37px, 10vw, 48px);
  }
  .detail-gallery {
    padding-top: 54px;
  }
  .detail-gallery-heading {
    display: flex;
    flex-direction: column-reverse;
    gap: 16px;
    margin-bottom: 0;
  }
  .detail-gallery h2 {
    font-size: clamp(27px, 7.7vw, 40px);
  }
  .detail-gallery-aside {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: end;
    gap: 6px 16px;
    border-left: 0;
    border-top: 1px solid #bbc8da;
    padding: 16px 0 0;
  }
  .detail-gallery-count strong {
    font-size: 34px;
  }
  .detail-gallery-count {
    grid-column: 1 / -1;
  }
  .detail-gallery-place {
    grid-column: 1;
    margin: 0;
    font-size: 12px;
  }
  .detail-gallery-action {
    grid-column: 1 / -1;
    margin-top: 10px;
  }
  .property-page .gallery-main {
    height: calc(100cqw / 1.12 * .85);
  }
  .gallery-empty {
    aspect-ratio: calc(1.12 / .85);
  }
  .detail-gallery-caption {
    font-size: 10px;
  }
  .property-page .detail-specs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-top: 38px;
  }
  .property-page .detail-specs > div {
    padding: 20px 10px 22px 0;
  }
  .property-page .detail-specs > div + div {
    padding-left: 0;
    border-left: 0;
  }
  .property-page .detail-specs > div:nth-child(even) {
    padding-left: 16px;
    border-left: 1px solid #bbc8da;
  }
  .property-page .detail-specs > div:nth-child(n + 3) {
    border-top: 1px solid #bbc8da;
  }
  .property-page .detail-specs > div.detail-spec-text {
    grid-column: 1 / -1;
    padding-left: 0;
    border-left: 0;
  }
  .property-page .detail-specs dd {
    font-size: clamp(27px, 7vw, 36px);
  }
  .detail-story {
    padding-top: 42px;
    padding-bottom: 56px;
  }
  .property-page .detail-text h2 {
    font-size: clamp(27px, 7.7vw, 38px);
  }
  .property-page .utilities {
    grid-template-columns: 1fr;
  }
  .detail-finance {
    padding: 28px 0;
  }
  .detail-finance :deep(.mortgage h2) {
    font-size: 20px;
  }
  .detail-enquiry-story h2 {
    font-size: clamp(27px, 7.8vw, 39px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .detail-hero-cta svg,
  .detail-gallery-action {
    transition: none;
  }
}
</style>
