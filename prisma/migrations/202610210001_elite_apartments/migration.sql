ALTER TABLE "Property" ADD COLUMN "elite" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Property" ADD CONSTRAINT "Property_elite_manual_apartment_check"
CHECK (NOT "elite" OR ("type" = 'apartment' AND "sourceId" IS NULL));
