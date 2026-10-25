import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { initializeSite } from "../prisma/seed";

test("restart preserves deleted, renamed and unpublished initial articles", async () => {
  let admins = 0;
  let articleWrites = 0;
  const articles = new Map<
    string,
    { slug: string; title: string; published: boolean }
  >();
  const tx = {
    $executeRaw: async () => 1,
    adminUser: {
      count: async () => admins,
      upsert: async () => {
        admins = 1;
      },
    },
    article: {
      upsert: async ({
        create,
      }: {
        create: { slug: string; title: string; published: boolean };
      }) => {
        articleWrites++;
        articles.set(create.slug, { ...create });
      },
    },
  };
  const db = {
    $transaction: (callback: (value: typeof tx) => Promise<boolean>) =>
      callback(tx),
  } as unknown as PrismaClient;
  assert.equal(
    await initializeSite(
      db,
      "editor@example.test",
      "test-password-at-least-16-chars",
    ),
    true,
  );
  assert.ok(articles.size > 2);
  const [deleted, renamed, edited] = [...articles.keys()];
  articles.delete(deleted!);
  const renamedArticle = articles.get(renamed!)!;
  articles.delete(renamed!);
  articles.set("renamed-by-editor", {
    ...renamedArticle,
    slug: "renamed-by-editor",
  });
  articles.set(edited!, {
    ...articles.get(edited!)!,
    title: "Редакторский текст",
    published: false,
  });
  const expected = [...articles.entries()];
  const previousWrites = articleWrites;
  assert.equal(
    await initializeSite(
      db,
      "editor@example.test",
      "test-password-at-least-16-chars",
    ),
    false,
  );
  assert.deepEqual([...articles.entries()], expected);
  assert.equal(articleWrites, previousWrites);
});
