BEGIN;
SET LOCAL search_path = pg_temp, app;
CREATE TEMP TABLE "Article" AS SELECT id, slug, title, excerpt, content FROM app."Article";
INSERT INTO "Article" SELECT id || '-manual', slug, 'Editor title', 'Editor excerpt', 'Editorial prefix. ' || content FROM "Article";

\ir ../prisma/migrations/202610200002_article_copy/migration.sql

DO $$ BEGIN
  IF (SELECT count(*) FROM "Article" WHERE id NOT LIKE '%-manual' AND slug = 'planirovka-i-priemka-kvartiry' AND title LIKE '%перед получением ключей') <> 1 THEN RAISE EXCEPTION 'Article title migration mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM "Article" WHERE id LIKE '%-manual' AND (title <> 'Editor title' OR excerpt <> 'Editor excerpt' OR content NOT LIKE 'Editorial prefix. %')) THEN RAISE EXCEPTION 'Editorial text was overwritten'; END IF;
  IF EXISTS (SELECT 1 FROM "Article" WHERE content LIKE '%проверить квартиру на несколько обычных бытовых сценариев%' OR content LIKE '%Не переносите устные обещания%' OR content LIKE '%На Квартирукупить сведения об объектах сопровождаются ссылкой на источник%') THEN RAISE EXCEPTION 'Old article copy remains'; END IF;
END $$;
SELECT 'Article repair assertions passed; production tables untouched' AS result;
ROLLBACK;
