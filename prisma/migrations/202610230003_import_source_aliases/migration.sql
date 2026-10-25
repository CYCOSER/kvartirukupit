CREATE TABLE "PropertyImportSource" (
    "sourceId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "apartmentKey" TEXT,
    CONSTRAINT "PropertyImportSource_pkey" PRIMARY KEY ("sourceId")
);

CREATE INDEX "PropertyImportSource_propertyId_idx" ON "PropertyImportSource"("propertyId");
CREATE INDEX "PropertyImportSource_apartmentKey_idx" ON "PropertyImportSource"("apartmentKey");
ALTER TABLE "PropertyImportSource" ADD CONSTRAINT "PropertyImportSource_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "PropertyImportSource" ("sourceId", "propertyId")
SELECT "sourceId", "id" FROM "Property" WHERE "sourceId" IS NOT NULL;
