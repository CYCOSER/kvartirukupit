BEGIN;
SET LOCAL search_path = pg_temp, app;
CREATE TEMP TABLE "Property" AS SELECT id, "sourceId", description FROM app."Property" WHERE "sourceId" IN ('curated:zhk-adres-schastya', 'curated:zhk-ratskhof-dom', 'curated:zhk-tikhiy-dom');
INSERT INTO "Property" SELECT id || '-manual', "sourceId", 'Ручное вступление редактора.' || E'\r\n\r\n' || replace(description, E'\n', E'\r\n') || E'\r\n\r\n' || 'Дополнение редактора после импортированного блока.' FROM "Property";
INSERT INTO "Property" VALUES ('custom-editorial', 'curated:zhk-tikhiy-dom', 'Моё описание. Можно гулять со всей семьей. Мой текст после.');

\ir ../prisma/migrations/202610200003_catalog_description_cleanup/migration.sql

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Property" WHERE description ~* '(нмаркет|9 140 000|8 637 000|Наличие и стоимость квартир необходимо уточнить)') THEN RAISE EXCEPTION 'Imported source block remains'; END IF;
  IF EXISTS (SELECT 1 FROM "Property" WHERE id LIKE '%-manual' AND (description NOT LIKE 'Ручное вступление редактора.%' OR description NOT LIKE '%Дополнение редактора после импортированного блока.')) THEN RAISE EXCEPTION 'Editorial paragraphs were changed'; END IF;
  IF (SELECT description FROM "Property" WHERE id = 'custom-editorial') <> 'Моё описание. Можно гулять со всей семьёй. Мой текст после.' THEN RAISE EXCEPTION 'Surrounding editorial text was changed'; END IF;
  IF EXISTS (SELECT 1 FROM "Property" WHERE description ~ '(полноценно жилой|здоровой ритм|в течении долгих|детская поликлиник\.|со всей семьей|есть все для удобства|В непосредственной близости вся|четырехкомнатных|соседствующих европейских|Потолки 3 метра\.|Вся застройка отвечает трем|6-этажный кирпичный)') THEN RAISE EXCEPTION 'Known grammar errors remain'; END IF;
END $$;
CREATE TEMP TABLE first_result AS TABLE "Property";

\ir ../prisma/migrations/202610200003_catalog_description_cleanup/migration.sql

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Property" AS p JOIN first_result USING (id) WHERE p.description <> first_result.description) THEN RAISE EXCEPTION 'Cleanup was not idempotent'; END IF;
END $$;
SELECT 'Description cleanup: actual copy, CRLF, editorial paragraphs and idempotence passed' AS result;
ROLLBACK;
