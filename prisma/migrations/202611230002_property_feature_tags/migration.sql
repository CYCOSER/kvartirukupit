ALTER TABLE "tags" ADD COLUMN "property_feature_id" TEXT;

CREATE UNIQUE INDEX "tags_property_feature_id_key" ON "tags"("property_feature_id");
ALTER TABLE "tags" ADD CONSTRAINT "tags_property_feature_id_fkey"
  FOREIGN KEY ("property_feature_id") REFERENCES "PropertyFeature"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing ordinary tags keep their meaning, even when their names match a badge.
DO $$
DECLARE
  feature RECORD;
  group_label TEXT;
  tag_name TEXT;
  suffix TEXT;
  collision INTEGER;
BEGIN
  FOR feature IN SELECT "id", "name", "group" FROM "PropertyFeature" ORDER BY "group", "name", "id" LOOP
    group_label := CASE feature."group"
      WHEN 'heating' THEN 'Отопление'
      WHEN 'territory' THEN 'Территория'
      WHEN 'location' THEN 'Локация'
      ELSE 'Другие значки'
    END;
    tag_name := left(feature."name", 120);
    IF EXISTS (SELECT 1 FROM "tags" WHERE "name" = tag_name) THEN
      suffix := ' (' || group_label || ')';
      tag_name := left(feature."name", 120 - char_length(suffix)) || suffix;
    END IF;
    collision := 0;
    WHILE EXISTS (SELECT 1 FROM "tags" WHERE "name" = tag_name) LOOP
      suffix := ' (' || group_label || ', ' || md5(feature."id")
        || CASE WHEN collision = 0 THEN '' ELSE '-' || collision::TEXT END || ')';
      tag_name := left(feature."name", 120 - char_length(suffix)) || suffix;
      collision := collision + 1;
    END LOOP;
    INSERT INTO "tags" ("id", "name", "property_feature_id")
      VALUES ('feature-tag-' || md5(feature."id"), tag_name, feature."id");
  END LOOP;
END $$;

INSERT INTO "tags_relations" ("id", "tag_id", "property_id")
SELECT 'feature-relation-' || md5(tag."id" || ':' || selection."A"), tag."id", selection."A"
FROM "_PropertyToPropertyFeature" selection
JOIN "tags" tag ON tag."property_feature_id" = selection."B"
ON CONFLICT ("tag_id", "property_id") DO NOTHING;
