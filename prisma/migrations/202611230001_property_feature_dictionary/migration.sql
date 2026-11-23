CREATE TYPE "PropertyFeatureGroup" AS ENUM ('heating', 'territory', 'location', 'other');

CREATE TABLE "PropertyFeature" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "group" "PropertyFeatureGroup" NOT NULL,
  CONSTRAINT "PropertyFeature_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PropertyFeature_group_name_key" ON "PropertyFeature"("group", "name");

ALTER TABLE "Property" ADD COLUMN "featureOverrides" "PropertyFeatureGroup"[] NOT NULL DEFAULT ARRAY[]::"PropertyFeatureGroup"[];

CREATE TABLE "_PropertyToPropertyFeature" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  CONSTRAINT "_PropertyToPropertyFeature_AB_pkey" PRIMARY KEY ("A", "B")
);
CREATE INDEX "_PropertyToPropertyFeature_B_index" ON "_PropertyToPropertyFeature"("B");
ALTER TABLE "_PropertyToPropertyFeature" ADD CONSTRAINT "_PropertyToPropertyFeature_A_fkey"
  FOREIGN KEY ("A") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_PropertyToPropertyFeature" ADD CONSTRAINT "_PropertyToPropertyFeature_B_fkey"
  FOREIGN KEY ("B") REFERENCES "PropertyFeature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "PropertyFeature" ("id", "name", "group") VALUES
  ('feature-fenced-territory', 'Огороженная территория', 'territory'),
  ('feature-location-city', 'Центр города', 'location'),
  ('feature-location-sea', 'У моря', 'location'),
  ('feature-location-park', 'У парка', 'location'),
  ('feature-location-country', 'За городом', 'location');

INSERT INTO "PropertyFeature" ("id", "name", "group")
SELECT DISTINCT 'feature-heating-' || md5(btrim("heatingType")), btrim("heatingType"), 'heating'::"PropertyFeatureGroup"
FROM "Property" WHERE nullif(btrim("heatingType"), '') IS NOT NULL;

INSERT INTO "PropertyFeature" ("id", "name", "group")
SELECT DISTINCT 'feature-location-' || md5(btrim(tag)), btrim(tag), 'location'::"PropertyFeatureGroup"
FROM "Property", unnest("locationTags") AS tag WHERE nullif(btrim(tag), '') IS NOT NULL
ON CONFLICT ("group", "name") DO NOTHING;

INSERT INTO "_PropertyToPropertyFeature" ("A", "B")
SELECT p."id", f."id" FROM "Property" p JOIN "PropertyFeature" f ON
  (f."group" = 'heating' AND f."name" = btrim(p."heatingType")) OR
  (f."group" = 'territory' AND p."fencedTerritory" IS TRUE) OR
  (f."group" = 'location' AND EXISTS (SELECT 1 FROM unnest(p."locationTags") AS tag WHERE btrim(tag) = f."name"));

UPDATE "Property" SET "featureOverrides" =
  (CASE WHEN nullif(btrim("heatingType"), '') IS NOT NULL THEN ARRAY['heating']::"PropertyFeatureGroup"[] ELSE ARRAY[]::"PropertyFeatureGroup"[] END) ||
  (CASE WHEN "fencedTerritory" IS NOT NULL THEN ARRAY['territory']::"PropertyFeatureGroup"[] ELSE ARRAY[]::"PropertyFeatureGroup"[] END) ||
  (CASE WHEN cardinality("locationTags") > 0 THEN ARRAY['location']::"PropertyFeatureGroup"[] ELSE ARRAY[]::"PropertyFeatureGroup"[] END);
