UPDATE "Article"
SET "publishedAt" = NULL
WHERE "published" = false AND "publishedAt" IS NOT NULL;
