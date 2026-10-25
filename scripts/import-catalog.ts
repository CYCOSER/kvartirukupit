import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { propertySchema } from "../shared/property";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "A public HTTPS source is required");
const optionalText = z.string().trim().max(2000).nullable();
const curatedProjectSchema = propertySchema
  .and(z.object({
    type: z.literal("complex"),
    elite: z.literal(false).default(false),
    sourceId: z.string(),
    sourceUrl,
    sourceName: z.string().trim().min(1).max(200),
    sourceMode: z.literal("curated"),
    sourceNote: z.string().trim().max(5000),
    sourceFetchedAt: z.string().datetime({ offset: true }),
    developer: optionalText,
    district: optionalText,
    completionDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    constructionStatus: optionalText,
    priceKind: z.literal("from").nullable(),
    priceSourceUrl: sourceUrl.nullable(),
    priceArea: z.number().positive().max(10000).nullable(),
    images: z
      .array(
        z.object({
          file: z
            .string()
            .regex(
              /^\/images\/projects\/[a-z0-9-]+\/[a-zA-Z0-9_-]+\.(?:webp|jpe?g|png)$/,
            ),
          alt: z.string().trim().min(1).max(200),
          sourceUrl,
          width: z.number().int().positive(),
          height: z.number().int().positive(),
          kind: z.string().trim().min(1).max(50),
        }),
      )
      .max(100),
  }))
  .superRefine((project, context) => {
    if (
      project.price !== null &&
      (project.price <= 0 ||
        project.priceKind !== "from" ||
        !project.priceSourceUrl)
    )
      context.addIssue({
        code: "custom",
        path: ["price"],
        message:
          "A complex price must be the verified minimum of available apartments",
      });
    if (project.sourceId !== "curated:" + project.slug)
      context.addIssue({
        code: "custom",
        path: ["sourceId"],
        message: "Source ID must match the project slug",
      });
    if (Date.parse(project.sourceFetchedAt) > Date.now() + 300000)
      context.addIssue({
        code: "custom",
        path: ["sourceFetchedAt"],
        message: "Source date is in the future",
      });
    if (
      project.images.some(
        (image) =>
          !image.file.startsWith("/images/projects/" + project.slug + "/"),
      )
    )
      context.addIssue({
        code: "custom",
        path: ["images"],
        message: "Images must belong to this project directory",
      });
  });

export function validateCatalog(input: unknown) {
  const projects = z.array(curatedProjectSchema).min(1).parse(input);
  if (
    new Set(projects.map((project) => project.sourceId)).size !==
    projects.length
  )
    throw new Error("Duplicate curated project identifiers");
  return projects.map((project) => ({
    ...project,
    description: project.description
      .split(/\r?\n\s*\r?\n/)
      .filter(
        (paragraph) =>
          !/(?:нмаркет|nmarket|(?:наш\.)?дом\.рф|https?:\/\/|www\.)/i.test(
            paragraph,
          ) &&
          paragraph.trim() !==
            "Наличие и стоимость квартир необходимо уточнить перед покупкой.",
      )
      .join("\n\n"),
    images: project.images.filter((image) => !["floorplan", "plan"].includes(image.kind)).map((image) => ({
      ...image,
      alt:
        image.alt
          .replace(/(?:,\s*|\s+из\s+|\s+)(?:НМаркет\.ПРО|nmarket\.pro)/gi, "")
          .trim() || project.title,
    })),
  }));
}

export async function loadCatalog(directory = resolve(root, "data/curated")) {
  const publicDirectory = resolve(
    root,
    process.env.NODE_ENV === "production" ? ".output/public" : "public",
  );
  const files = (await readdir(directory))
    .filter((name) => name.endsWith(".json"))
    .sort();
  const projects = validateCatalog(
    await Promise.all(
      files.map(async (name) =>
        JSON.parse(await readFile(resolve(directory, name), "utf8")),
      ),
    ),
  );
  for (const project of projects) {
    for (const image of project.images) {
      const file = await stat(resolve(publicDirectory, image.file.slice(1)));
      if (!file.isFile() || !file.size)
        throw new Error("Missing local project image: " + image.file);
    }
  }
  return projects;
}

export async function importCatalog(db: PrismaClient, input: unknown) {
  const projects = validateCatalog(input);
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(731905221)`;
      const archived = await tx.property.updateMany({
        where: {
          elite: false,
          sourceName: "наш.дом.рф",
          sourceMode: { in: ["indexed", "live"] },
        },
        data: { published: false, sourceMode: "archived-domrf" },
      });
      let imported = 0;
      for (const project of projects) {
        const existing = await tx.property.findUnique({
          where: { sourceId: project.sourceId },
          include: { images: true },
        });
        if (existing?.elite) continue;
        if (
          existing?.sourceFetchedAt &&
          existing.sourceFetchedAt.getTime() >=
            Date.parse(project.sourceFetchedAt)
        )
          continue;
        const { images, slug, published, featured, status, latitude, longitude, ...source } =
          project;
        const data = {
          ...source,
          ...(latitude !== null && longitude !== null ? { latitude, longitude } : {}),
          sourceFetchedAt: new Date(source.sourceFetchedAt),
        };
        const property = await tx.property.upsert({
          where: { sourceId: project.sourceId },
          create: { ...data, slug, published, featured, status },
          update: data,
        });
        const previous = existing?.images || [];
        const localImages = previous.filter((image) =>
          image.file.startsWith("/images/projects/"),
        );
        const manualImages = previous.filter(
          (image) => !image.file.startsWith("/images/projects/"),
        );
        await tx.propertyImage.deleteMany({
          where: {
            propertyId: property.id,
            id: { in: localImages.map((image) => image.id) },
          },
        });
        const offset =
          Math.max(-1, ...manualImages.map((image) => image.order)) + 1;
        await tx.propertyImage.createMany({
          data: images.map((image, order) => ({
            propertyId: property.id,
            file: image.file,
            alt: image.alt,
            order: offset + order,
          })),
        });
        imported++;
      }
      return {
        imported,
        skipped: projects.length - imported,
        archived: archived.count,
      };
    },
    { timeout: 120000 },
  );
}

export async function importLegacyLeads(db: PrismaClient) {
  const [table] = await db.$queryRaw<
    { name: string | null }[]
  >`SELECT to_regclass('public.leads')::text AS name`;
  if (!table?.name) return 0;
  const leads = await db.$queryRaw<
    {
      id: string;
      name: string;
      phone: string;
      project_id: string | null;
      consent_at: Date | null;
      created_at: Date;
    }[]
  >`SELECT id::text, name, phone, project_id, consent_at, created_at FROM public.leads`;
  for (const lead of leads) {
    const property = lead.project_id
      ? await db.property.findUnique({
          where: { sourceId: lead.project_id },
          select: { id: true },
        })
      : null;
    await db.lead.upsert({
      where: { id: "legacy-" + lead.id },
      update: {},
      create: {
        id: "legacy-" + lead.id,
        name: lead.name,
        phone: lead.phone,
        propertyId: property?.id || null,
        comment:
          lead.project_id && !property
            ? "Объект прежнего каталога: " + lead.project_id
            : "",
        consent: Boolean(lead.consent_at),
        consentVersion: "2026-10-18",
        createdAt: lead.created_at,
      },
    });
  }
  return leads.length;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const db = new PrismaClient();
  try {
    console.log(
      JSON.stringify(
        await importCatalog(db, await loadCatalog(process.argv[2])),
      ),
    );
  } finally {
    await db.$disconnect();
  }
}
