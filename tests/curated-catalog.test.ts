import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { importCatalog, validateCatalog } from "../scripts/import-catalog";

const project = {
  title: "ЖК из локального каталога",
  slug: "zhk-test",
  type: "complex",
  location: "Калининград",
  address: "Калининград, тестовый адрес",
  price: null,
  status: "available",
  area: null,
  landArea: null,
  bedrooms: null,
  floors: null,
  readiness: "Уточняется",
  finish: "Уточняется",
  seaDistance: null,
  description: "Описание с проверенным источником.",
  utilities: [],
  published: true,
  featured: true,
  demo: false,
  sourceId: "curated:zhk-test",
  sourceUrl: "https://developer.example/project",
  sourceName: "Застройщик",
  sourceMode: "curated",
  sourceNote: "Изображение — рендер проекта.",
  sourceFetchedAt: "2026-01-01T00:00:00.000Z",
  developer: "Застройщик",
  district: null,
  completionDate: null,
  constructionStatus: "Строится",
  priceKind: null,
  priceSourceUrl: null,
  priceArea: null,
  images: [
    {
      file: "/images/projects/zhk-test/01.webp",
      alt: "Рендер жилого комплекса",
      sourceUrl: "https://developer.example/render.webp",
      width: 1200,
      height: 800,
      kind: "render",
    },
  ],
};

test("complex galleries exclude apartment floor plans, including a catalog containing only plans", () => {
  const photo = project.images[0]!;
  const plans = ["floorplan", "plan"].map((kind) => ({ ...photo, kind }));
  assert.deepEqual(validateCatalog([{ ...project, images: [...plans, photo] }])[0]!.images, [photo]);
  const cleaned = validateCatalog([{ ...project, images: plans }]);
  assert.deepEqual(cleaned[0]!.images, []);
  assert.deepEqual(validateCatalog(cleaned)[0]!.images, []);
});

test("curated catalog validates identity, local images and provenance before database writes", async () => {
  assert.equal(validateCatalog([project])[0]!.price, null);
  const db = {
    $transaction() {
      assert.fail("Invalid input must not reach PostgreSQL");
    },
  } as unknown as PrismaClient;
  for (const input of [
    [],
    [project, project],
    [{ ...project, sourceId: "123" }],
    [{ ...project, elite: true }],
    [{ ...project, sourceUrl: "javascript:alert(1)" }],
    [{ ...project, sourceFetchedAt: "2999-01-01T00:00:00Z" }],
    [
      {
        ...project,
        price: 9000000,
        priceKind: "example",
        priceSourceUrl: project.sourceUrl,
      },
    ],
    [{ ...project, price: 9000000 }],
    [
      {
        ...project,
        images: [
          { ...project.images[0], file: "/images/projects/other/01.webp" },
        ],
      },
    ],
    [
      {
        ...project,
        images: [
          {
            ...project.images[0],
            file: "/images/projects/zhk-test/../secret.webp",
          },
        ],
      },
    ],
  ])
    await assert.rejects(importCatalog(db, input));
});

test("import keeps provenance private and accepts only a verified starting price for complexes", () => {
  const [saved] = validateCatalog([
    {
      ...project,
      price: 5000000,
      priceKind: "from",
      priceSourceUrl: project.sourceUrl,
      description:
        "Кирпичный дом.\n\nПримеры квартир из выгрузки НМаркет.ПРО:\nКвартира — 9 000 000 ₽.\n\nЗакрытый двор.\n\nИсточник: https://service.example",
      images: [
        {
          ...project.images[0],
          alt: "ЖК — изображение комплекса из НМаркет.ПРО",
        },
      ],
    },
  ]);
  assert.equal(saved!.description, "Кирпичный дом.\n\nЗакрытый двор.");
  assert.equal(saved!.images[0]!.alt, "ЖК — изображение комплекса");
  assert.equal(saved!.price, 5000000);
  assert.equal(saved!.sourceUrl, project.sourceUrl);
});

test("source paragraph and its apartment examples are removed with LF or CRLF without losing editorial paragraphs", () => {
  const paragraphs = [
    "Ручное вступление редактора.",
    "В ближайшем окружении есть всё для удобства жизни: супермаркеты, аптеки и фитнес-центры.",
    "Примеры квартир из выгрузки НМаркет.ПРО:\n2-комнатная квартира, 60,6 м², 2 этаж — 9 140 000 ₽.\n2-комнатная квартира, 55,4 м², 3 этаж — 8 637 000 ₽.",
    "Наличие и стоимость квартир необходимо уточнить перед покупкой.",
    "Дополнение редактора после импортированного блока.",
  ];
  for (const newline of ["\n", "\r\n"]) {
    const [saved] = validateCatalog([
      {
        ...project,
        description: paragraphs.join("\n\n").replace(/\n/g, newline),
      },
    ]);
    assert.equal(
      saved!.description,
      [paragraphs[0], paragraphs[1], paragraphs[4]].join("\n\n"),
    );
    assert.doesNotMatch(
      saved!.description,
      /9 140 000|8 637 000|НМаркет|Наличие и стоимость/,
    );
    assert.equal(validateCatalog([saved])[0]!.description, saved!.description);
  }
});

test("import keeps manual coordinates when the source omits them and accepts a verified pair", async () => {
  let saved: { create: { latitude?: number; longitude?: number }; update: { latitude?: number; longitude?: number } } | undefined;
  const db = {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({
      $executeRaw: async () => 1,
      property: {
        updateMany: async () => ({ count: 0 }),
        findUnique: async () => ({ latitude: 54.71, longitude: 20.45, images: [] }),
        upsert: async (args: NonNullable<typeof saved>) => { saved = args; return { id: "map-property" }; },
      },
      propertyImage: { deleteMany: async () => ({}), createMany: async () => ({}) },
    }),
  } as unknown as PrismaClient;
  await importCatalog(db, [project]);
  assert.equal(Object.hasOwn(saved!.update, "latitude"), false);
  assert.equal(Object.hasOwn(saved!.update, "longitude"), false);
  await importCatalog(db, [{ ...project, latitude: 54.72, longitude: 20.44 }]);
  assert.equal(saved!.create.latitude, 54.72);
  assert.equal(saved!.update.longitude, 20.44);
});

test("import never overwrites an elite apartment", async () => {
  const db = {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({
      $executeRaw: async () => 1,
      property: {
        updateMany: async ({ where }: { where: { elite: boolean } }) => {
          assert.equal(where.elite, false);
          return { count: 0 };
        },
        findUnique: async () => ({ elite: true }),
        upsert: async () => assert.fail("Elite apartments must not be imported"),
      },
    }),
  } as unknown as PrismaClient;
  assert.deepEqual(await importCatalog(db, [project]), {
    imported: 0,
    skipped: 1,
    archived: 0,
  });
});

test("local import archives old records once and preserves manual changes on restart", async () => {
  type Image = {
    id: string;
    file: string;
    alt: string;
    order: number;
    propertyId: string;
  };
  type Record = {
    id: string;
    sourceId: string;
    sourceName: string;
    sourceMode: string;
    sourceFetchedAt: Date | null;
    title: string;
    slug: string;
    published: boolean;
    featured: boolean;
    status: string;
    images: Image[];
  };
  const old: Record = {
    id: "old-property",
    sourceId: "65567",
    sourceName: "наш.дом.рф",
    sourceMode: "indexed",
    sourceFetchedAt: new Date("2025-01-01"),
    title: "Старый объект",
    slug: "old",
    published: true,
    featured: true,
    status: "available",
    images: [],
  };
  const records = new Map<string, Record>([[old.sourceId, old]]);
  let imageSequence = 0;
  const tx = {
    $executeRaw: async () => 1,
    property: {
      updateMany: async ({
        where,
        data,
      }: {
        where: { sourceName: string; sourceMode: { in: string[] } };
        data: Partial<Record>;
      }) => {
        let count = 0;
        for (const item of records.values()) {
          if (
            item.sourceName === where.sourceName &&
            where.sourceMode.in.includes(item.sourceMode)
          ) {
            Object.assign(item, data);
            count++;
          }
        }
        return { count };
      },
      findUnique: async ({ where }: { where: { sourceId: string } }) =>
        records.get(where.sourceId) || null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { sourceId: string };
        create: Record;
        update: Partial<Record>;
      }) => {
        const current = records.get(where.sourceId);
        if (current) {
          Object.assign(current, update);
          return current;
        }
        const inserted = { ...create, id: "curated-property", images: [] };
        records.set(where.sourceId, inserted);
        return inserted;
      },
    },
    propertyImage: {
      deleteMany: async ({
        where,
      }: {
        where: { propertyId: string; id: { in: string[] } };
      }) => {
        for (const item of records.values())
          if (item.id === where.propertyId)
            item.images = item.images.filter(
              (image) => !where.id.in.includes(image.id),
            );
      },
      createMany: async ({ data }: { data: Omit<Image, "id">[] }) => {
        for (const image of data) {
          const item = [...records.values()].find(
            (value) => value.id === image.propertyId,
          )!;
          item.images.push({ ...image, id: "image-" + imageSequence++ });
        }
      },
    },
  };
  const db = {
    $transaction: (callback: (value: typeof tx) => Promise<unknown>) =>
      callback(tx),
  } as unknown as PrismaClient;
  assert.deepEqual(await importCatalog(db, [project]), {
    imported: 1,
    skipped: 0,
    archived: 1,
  });
  assert.equal(old.sourceMode, "archived-domrf");
  assert.equal(old.published, false);
  assert.equal(
    records.has("65567"),
    true,
    "The old object remains available to its leads",
  );
  const saved = records.get(project.sourceId)!;
  Object.assign(saved, {
    title: "Текст редактора",
    slug: "editor-slug",
    published: false,
    status: "reserved",
  });
  old.published = true;
  saved.images.push({
    id: "manual",
    file: "/uploads/manual.webp",
    alt: "Ручное фото",
    order: 7,
    propertyId: saved.id,
  });
  assert.deepEqual(await importCatalog(db, [project]), {
    imported: 0,
    skipped: 1,
    archived: 0,
  });
  assert.equal(saved.title, "Текст редактора");
  assert.equal(saved.published, false);
  assert.equal(
    old.published,
    true,
    "Archiving is not repeated after an explicit manual change",
  );
  assert.deepEqual(
    await importCatalog(db, [
      {
        ...project,
        title: "Обновлённое описание",
        sourceFetchedAt: "2026-02-01T00:00:00Z",
      },
    ]),
    { imported: 1, skipped: 0, archived: 0 },
  );
  assert.equal(saved.title, "Обновлённое описание");
  assert.equal(saved.slug, "editor-slug");
  assert.equal(saved.status, "reserved");
  assert.equal(saved.published, false);
  assert.equal(
    saved.images.find((image) => image.file === project.images[0]!.file)?.order,
    8,
  );
  assert.ok(saved.images.some((image) => image.id === "manual"));
  assert.deepEqual(await importCatalog(db, [project]), {
    imported: 0,
    skipped: 1,
    archived: 0,
  });
});
