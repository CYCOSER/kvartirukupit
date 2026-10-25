CREATE TABLE "Article" (
 "id" TEXT NOT NULL, "slug" TEXT NOT NULL, "title" TEXT NOT NULL,
 "excerpt" TEXT NOT NULL, "content" TEXT NOT NULL,
 "seoTitle" TEXT NOT NULL DEFAULT '', "seoDescription" TEXT NOT NULL DEFAULT '',
 "published" BOOLEAN NOT NULL DEFAULT false, "publishedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Article_slug_key" ON "Article"("slug");
CREATE INDEX "Article_published_publishedAt_idx" ON "Article"("published", "publishedAt");
