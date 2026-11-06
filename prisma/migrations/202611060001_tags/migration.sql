CREATE TABLE "tags" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

CREATE TABLE "tags_relations" (
  "id" TEXT NOT NULL,
  "tag_id" TEXT NOT NULL,
  "property_id" TEXT,
  "article_id" TEXT,
  CONSTRAINT "tags_relations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tags_relations_target_check"
    CHECK (num_nonnulls("property_id", "article_id") = 1),
  CONSTRAINT "tags_relations_tag_id_fkey"
    FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tags_relations_property_id_fkey"
    FOREIGN KEY ("property_id") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tags_relations_article_id_fkey"
    FOREIGN KEY ("article_id") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "tags_relations_tag_id_property_id_key"
  ON "tags_relations"("tag_id", "property_id");
CREATE UNIQUE INDEX "tags_relations_tag_id_article_id_key"
  ON "tags_relations"("tag_id", "article_id");
CREATE INDEX "tags_relations_property_id_idx" ON "tags_relations"("property_id");
CREATE INDEX "tags_relations_article_id_idx" ON "tags_relations"("article_id");
