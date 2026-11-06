ALTER TABLE "Property"
ADD COLUMN "availableFloors" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN "layoutHash" TEXT;

CREATE INDEX "Property_layoutHash_idx" ON "Property"("layoutHash");

ALTER TABLE "PropertyImportSource"
ADD COLUMN "price" INTEGER,
ADD COLUMN "availableFloors" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
