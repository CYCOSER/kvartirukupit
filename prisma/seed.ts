import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { z } from "zod";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { articleSchema } from "../shared/article";
import { apartmentArticles } from "./apartment-articles";
import {
  importCatalog,
  importLegacyLeads,
  loadCatalog,
} from "../scripts/import-catalog";

export async function initializeSite(
  db: PrismaClient,
  email: string,
  password: string,
) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(731905222)`;
    const firstSetup = (await tx.adminUser.count()) === 0;
    await tx.adminUser.upsert({
      where: { email },
      update: {},
      create: { email, passwordHash: await hash(password) },
    });
    if (firstSetup) {
      for (const article of apartmentArticles) {
        await tx.article.upsert({
          where: { slug: article.slug },
          update: {},
          create: {
            ...articleSchema.parse(article),
            publishedAt: new Date("2026-10-18T10:00:00.000Z"),
          },
        });
      }
    }
    return firstSetup;
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const db = new PrismaClient();
  try {
    const email = z
      .string()
      .email()
      .parse(process.env.ADMIN_EMAIL?.toLowerCase());
    const password = process.env.ADMIN_PASSWORD;
    if (
      !password ||
      password.length < 16 ||
      /^replace[-_]/.test(password)
    )
      throw new Error(
        "Set ADMIN_EMAIL and a unique ADMIN_PASSWORD (16+ characters).",
      );
    const initialized = await initializeSite(db, email, password);
    const catalog = await importCatalog(db, await loadCatalog());
    const legacyLeads = await importLegacyLeads(db);
    console.log(JSON.stringify({ initialized, catalog, legacyLeads }));
  } finally {
    await db.$disconnect();
  }
}
