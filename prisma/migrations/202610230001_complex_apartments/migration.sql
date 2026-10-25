ALTER TABLE "Property"
  ADD COLUMN "complexId" TEXT,
  ADD COLUMN "nmarketComplexId" TEXT,
  ADD COLUMN "rf39ComplexId" TEXT,
  ADD COLUMN "rf39BuildingId" TEXT;

ALTER TABLE "PropertyImage" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'photo';

CREATE INDEX "Property_complexId_idx" ON "Property"("complexId");

ALTER TABLE "Property" ADD CONSTRAINT "Property_complexId_fkey"
  FOREIGN KEY ("complexId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;
