-- Run with psql -f tests/property-feature-migration.sql against an empty disposable database.
\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE "Property" (
  "id" TEXT PRIMARY KEY,
  "heatingType" TEXT,
  "fencedTerritory" BOOLEAN,
  "locationTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
);
INSERT INTO "Property" VALUES
  ('complex', 'Газовое', true, ARRAY['Центр города', 'У моря']),
  ('inherit', null, null, ARRAY[]::TEXT[]),
  ('no-fence', null, false, ARRAY[]::TEXT[]),
  ('own', 'Центральное', null, ARRAY['У парка']),
  ('same-heating', ' Газовое ', null, ARRAY['У озера']);

\ir ../prisma/migrations/202611230001_property_feature_dictionary/migration.sql

DO $$
BEGIN
  IF (SELECT count(*) FROM "PropertyFeature") <> 8 THEN RAISE EXCEPTION 'Dictionary backfill or built-in seed failed'; END IF;
  IF (SELECT count(*) FROM "_PropertyToPropertyFeature" WHERE "A" = 'complex') <> 4 THEN RAISE EXCEPTION 'Complex features lost'; END IF;
  IF (SELECT count(*) FROM "_PropertyToPropertyFeature" WHERE "A" = 'own') <> 2 THEN RAISE EXCEPTION 'Apartment overrides lost'; END IF;
  IF (SELECT count(*) FROM "_PropertyToPropertyFeature" WHERE "A" = 'no-fence') <> 0 THEN RAISE EXCEPTION 'False fence became selected'; END IF;
  IF (SELECT "featureOverrides" FROM "Property" WHERE "id" = 'no-fence') <> ARRAY['territory']::"PropertyFeatureGroup"[] THEN RAISE EXCEPTION 'False fence override lost'; END IF;
  IF (SELECT "featureOverrides" FROM "Property" WHERE "id" = 'inherit') <> ARRAY[]::"PropertyFeatureGroup"[] THEN RAISE EXCEPTION 'Inheritance changed'; END IF;
  IF (SELECT "featureOverrides" FROM "Property" WHERE "id" = 'complex') <> ARRAY['heating','territory','location']::"PropertyFeatureGroup"[] THEN RAISE EXCEPTION 'Group overrides lost'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "_PropertyToPropertyFeature" r JOIN "PropertyFeature" f ON f."id" = r."B" WHERE r."A" = 'same-heating' AND f."name" = 'Газовое') THEN RAISE EXCEPTION 'Trimmed heating lost'; END IF;
END $$;

UPDATE "PropertyFeature" SET "name" = 'Рядом с морем' WHERE "id" = 'feature-location-sea';
DELETE FROM "PropertyFeature" WHERE "id" = 'feature-fenced-territory';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "_PropertyToPropertyFeature" WHERE "B" = 'feature-fenced-territory') THEN RAISE EXCEPTION 'Deleted feature relation remains'; END IF;
  IF NOT ('territory' = ANY((SELECT "featureOverrides" FROM "Property" WHERE "id" = 'complex')::"PropertyFeatureGroup"[])) THEN RAISE EXCEPTION 'Deleting feature cleared group override'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "_PropertyToPropertyFeature" r JOIN "PropertyFeature" f ON f."id" = r."B" WHERE r."A" = 'complex' AND f."name" = 'Рядом с морем') THEN RAISE EXCEPTION 'Renaming broke assignment'; END IF;
END $$;
ROLLBACK;
