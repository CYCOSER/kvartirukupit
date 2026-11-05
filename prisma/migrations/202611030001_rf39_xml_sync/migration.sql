ALTER TABLE "Property" ADD COLUMN "rf39Baseline" JSONB;
ALTER TABLE "ImportJob" ADD COLUMN "updated" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "unpublished" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "ImportImageCache" (
  "url" TEXT NOT NULL PRIMARY KEY,
  "contentHash" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "originalFile" TEXT NOT NULL,
  "etag" TEXT,
  "lastModified" TEXT,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "planFile" TEXT,
  "planHueShift" INTEGER,
  "detectedPlan" BOOLEAN
);
CREATE TABLE "FeedSyncSetting" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'rf39',
  "ownerId" TEXT NOT NULL REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "url" TEXT NOT NULL DEFAULT 'https://feed.rf39.ru/30.xml',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "intervalMinutes" INTEGER NOT NULL DEFAULT 60 CHECK ("intervalMinutes" BETWEEN 15 AND 10080),
  "nextRunAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastError" TEXT,
  "lastJobId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
