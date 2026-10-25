ALTER TABLE "Property" ADD COLUMN "latitude" DOUBLE PRECISION,
                       ADD COLUMN "longitude" DOUBLE PRECISION;

ALTER TABLE "Property" ADD CONSTRAINT "Property_coordinates_check" CHECK (
  ("latitude" IS NULL AND "longitude" IS NULL) OR
  ("latitude" IS NOT NULL AND "longitude" IS NOT NULL AND
   "latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
);

-- Building coordinates from the local nmarket-kaliningrad.xml feed (19 October 2026).
-- A complex uses the first address shown on its current card, never a city centre.
UPDATE "Property" SET "latitude" = 54.7210383103, "longitude" = 20.5648134003
WHERE "sourceId" = 'curated:zhk-adres-schastya' AND "type" = 'complex' AND "elite" = false
  AND "address" LIKE '%34/3%' AND "latitude" IS NULL AND "longitude" IS NULL;
UPDATE "Property" SET "latitude" = 54.7123921053, "longitude" = 20.4409782989
WHERE "sourceId" = 'curated:zhk-ratskhof-dom' AND "type" = 'complex' AND "elite" = false
  AND "address" LIKE '%31/А%' AND "latitude" IS NULL AND "longitude" IS NULL;
UPDATE "Property" SET "latitude" = 54.7252189182, "longitude" = 20.4314633886
WHERE "sourceId" = 'curated:zhk-tikhiy-dom' AND "type" = 'complex' AND "elite" = false
  AND "address" LIKE '%81%' AND "latitude" IS NULL AND "longitude" IS NULL;
