-- Run with psql -f tests/property-feature-tags-migration.sql against an empty disposable database.
\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE "Property" (
  "id" TEXT PRIMARY KEY, "heatingType" TEXT, "fencedTerritory" BOOLEAN,
  "locationTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
);
CREATE TABLE "Article" ("id" TEXT PRIMARY KEY);
INSERT INTO "Property" VALUES
  ('complex', 'Газовое', true, ARRAY['У моря']),
  ('inherit', null, null, ARRAY[]::TEXT[]),
  ('no-fence', null, false, ARRAY[]::TEXT[]),
  ('own', 'Центральное', null, ARRAY['У парка']),
  ('ordinary-only', null, null, ARRAY[]::TEXT[]);
INSERT INTO "Article" VALUES ('article');
\ir ../prisma/migrations/202611060001_tags/migration.sql
\ir ../prisma/migrations/202611100001_tags_task/migration.sql
\ir ../prisma/migrations/202611230001_property_feature_dictionary/migration.sql
INSERT INTO "PropertyFeature" ("id", "name", "group") VALUES
  ('same-name-heating', 'Повтор', 'heating'),
  ('same-name-other', 'Повтор', 'other'),
  ('long-name-territory', repeat('Д', 120), 'territory'),
  ('long-name-other', repeat('Д', 120), 'other');
INSERT INTO "tags" ("id", "name") VALUES
  ('ordinary-sea', 'У моря'),
  ('ordinary-sea-group', 'У моря (Локация)'),
  ('ordinary-duplicate', 'Повтор'),
  ('ordinary-long', repeat('Д', 120));
INSERT INTO "tags_relations" ("id", "tag_id", "property_id", "article_id") VALUES
  ('ordinary-property', 'ordinary-sea', 'ordinary-only', null),
  ('ordinary-article', 'ordinary-sea', null, 'article');
INSERT INTO "tags_task" ("id", "type", "params", "tag_id") VALUES
  ('ordinary-task', 'apartment', '[{"param":"location","value_contain":"У моря"}]', 'ordinary-sea');
CREATE TEMP TABLE previous_properties AS TABLE "Property";
CREATE TEMP TABLE previous_selections AS TABLE "_PropertyToPropertyFeature";
CREATE TEMP TABLE previous_tags AS TABLE "tags";
CREATE TEMP TABLE previous_tasks AS TABLE "tags_task";
CREATE TEMP TABLE previous_relations AS TABLE "tags_relations";
\ir ../prisma/migrations/202611230002_property_feature_tags/migration.sql
DO $$
BEGIN
  IF EXISTS (SELECT * FROM "Property" EXCEPT SELECT * FROM previous_properties)
    OR EXISTS (SELECT * FROM previous_properties EXCEPT SELECT * FROM "Property") THEN
    RAISE EXCEPTION 'Property values or explicit/inherited overrides changed';
  END IF;
  IF EXISTS (SELECT * FROM "_PropertyToPropertyFeature" EXCEPT SELECT * FROM previous_selections)
    OR EXISTS (SELECT * FROM previous_selections EXCEPT SELECT * FROM "_PropertyToPropertyFeature") THEN
    RAISE EXCEPTION 'Direct feature selections changed';
  END IF;
  IF EXISTS (SELECT "id", "name" FROM previous_tags EXCEPT SELECT "id", "name" FROM "tags")
    OR EXISTS (SELECT 1 FROM "tags" WHERE "id" IN (SELECT "id" FROM previous_tags) AND "property_feature_id" IS NOT NULL) THEN
    RAISE EXCEPTION 'An ordinary tag was changed or converted into a badge';
  END IF;
  IF EXISTS (SELECT * FROM previous_tasks EXCEPT SELECT * FROM "tags_task")
    OR EXISTS (SELECT * FROM previous_relations EXCEPT SELECT * FROM "tags_relations") THEN
    RAISE EXCEPTION 'Existing tasks or property/article relations changed';
  END IF;
  IF (SELECT count(*) FROM "tags" WHERE "property_feature_id" IS NOT NULL) <> (SELECT count(*) FROM "PropertyFeature") THEN
    RAISE EXCEPTION 'Not every feature received its own tag';
  END IF;
  IF EXISTS (SELECT 1 FROM "tags" WHERE "property_feature_id" IS NOT NULL AND char_length("name") > 120)
    OR (SELECT count(DISTINCT "name") FROM "tags") <> (SELECT count(*) FROM "tags") THEN
    RAISE EXCEPTION 'Tag naming did not handle collisions within 120 characters';
  END IF;
  IF (SELECT "name" FROM "PropertyFeature" WHERE "id" = 'long-name-other') <> repeat('Д', 120) THEN
    RAISE EXCEPTION 'Public badge label was truncated';
  END IF;
  IF EXISTS (
    SELECT 1 FROM previous_selections selection
    WHERE NOT EXISTS (
      SELECT 1 FROM "tags_relations" relation JOIN "tags" tag ON tag."id" = relation."tag_id"
      WHERE tag."property_feature_id" = selection."B" AND relation."property_id" = selection."A"
    )
  ) OR (SELECT count(*) FROM "tags_relations") <> (SELECT count(*) FROM previous_relations) + (SELECT count(*) FROM previous_selections) THEN
    RAISE EXCEPTION 'Direct selections were not backfilled exactly once';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "tags_relations" relation JOIN "tags" tag ON tag."id" = relation."tag_id"
    WHERE tag."property_feature_id" IS NOT NULL
      AND (relation."article_id" IS NOT NULL OR relation."property_id" IN ('inherit', 'no-fence', 'ordinary-only'))
  ) THEN
    RAISE EXCEPTION 'Inherited, disabled, or ordinary tags created direct badge assignments';
  END IF;
END $$;
DELETE FROM "PropertyFeature" WHERE "id" = 'same-name-other';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "tags" WHERE "id" = 'feature-tag-' || md5('same-name-other') AND "property_feature_id" IS NULL) THEN
    RAISE EXCEPTION 'Feature deletion did not preserve the tag with a null link';
  END IF;
END $$;
ROLLBACK;
