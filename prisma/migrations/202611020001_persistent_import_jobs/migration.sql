CREATE TABLE "ImportJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerId" TEXT NOT NULL REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "requestId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "request" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "stopRequested" BOOLEAN NOT NULL DEFAULT false,
  "activeTitle" TEXT NOT NULL DEFAULT '',
  "total" INTEGER NOT NULL DEFAULT 0,
  "processed" INTEGER NOT NULL DEFAULT 0,
  "created" INTEGER NOT NULL DEFAULT 0,
  "linked" INTEGER NOT NULL DEFAULT 0,
  "existing" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "token" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "ImportJob_ownerId_requestId_key" ON "ImportJob"("ownerId", "requestId");
CREATE INDEX "ImportJob_status_leaseExpiresAt_createdAt_idx" ON "ImportJob"("status", "leaseExpiresAt", "createdAt");
CREATE TABLE "ImportJobItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "jobId" TEXT NOT NULL REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "key" TEXT NOT NULL,
  "groupOrder" INTEGER NOT NULL,
  "step" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "complexId" TEXT,
  "complexTitle" TEXT,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "result" JSONB,
  "error" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "ImportJobItem_jobId_key_key" ON "ImportJobItem"("jobId", "key");
CREATE INDEX "ImportJobItem_jobId_status_groupOrder_step_idx" ON "ImportJobItem"("jobId", "status", "groupOrder", "step");
