BEGIN;
SET LOCAL search_path = pg_temp, app;
CREATE TEMP TABLE "Property" AS SELECT id, "sourceId", "sourceFetchedAt", price, "priceKind", "priceArea", description, "sourceNote" FROM app."Property" WHERE "sourceMode" = 'curated';
CREATE TEMP TABLE "PropertyImage" AS SELECT * FROM app."PropertyImage" WHERE "propertyId" IN (SELECT id FROM "Property");
INSERT INTO "Property" SELECT id || '-manual', "sourceId", "sourceFetchedAt", 1234567, 'from', NULL, 'Editor description', 'Editor source note' FROM "Property";
INSERT INTO "PropertyImage" SELECT id || '-manual', "propertyId" || '-manual', file, 'Editor image alt', "order" FROM "PropertyImage";
\ir ../prisma/migrations/202610200001_catalog_available_prices/migration.sql
\ir ../prisma/migrations/202610200003_catalog_description_cleanup/migration.sql
DO $$ BEGIN
  IF (SELECT count(*) FROM "Property" WHERE id NOT LIKE '%-manual' AND (("sourceId" = 'curated:zhk-adres-schastya' AND price = 9460000) OR ("sourceId" = 'curated:zhk-ratskhof-dom' AND price = 5764000) OR ("sourceId" = 'curated:zhk-tikhiy-dom' AND price = 7900000)) AND "priceKind" = 'from' AND "priceArea" IS NULL) <> 3 THEN RAISE EXCEPTION 'Price migration mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM "Property" WHERE id LIKE '%-manual' AND (price <> 1234567 OR description <> 'Editor description' OR "sourceNote" <> 'Editor source note')) THEN RAISE EXCEPTION 'Manual property was changed'; END IF;
  IF EXISTS (SELECT 1 FROM "PropertyImage" WHERE id LIKE '%-manual' AND alt <> 'Editor image alt') THEN RAISE EXCEPTION 'Manual image was changed'; END IF;
  IF EXISTS (SELECT 1 FROM "Property" WHERE description LIKE '%НМаркет%') THEN RAISE EXCEPTION 'Source copy remains'; END IF;
  IF EXISTS (SELECT 1 FROM "PropertyImage" WHERE alt LIKE '%НМаркет%') THEN RAISE EXCEPTION 'Source alt remains'; END IF;
END $$;
SELECT 'Catalog repair assertions passed; production tables untouched' AS result;
ROLLBACK;
