CREATE TABLE "ImageUpscale" (
    "imageId" TEXT NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "outputFile" TEXT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "token" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ImageUpscale_pkey" PRIMARY KEY ("imageId")
);
CREATE INDEX "ImageUpscale_status_updatedAt_idx" ON "ImageUpscale"("status", "updatedAt");
ALTER TABLE "ImageUpscale" ADD CONSTRAINT "ImageUpscale_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "PropertyImage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
