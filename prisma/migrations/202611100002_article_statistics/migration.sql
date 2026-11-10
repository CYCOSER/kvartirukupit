CREATE TABLE "Article_visitor_session" (
  "id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Article_visitor_session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Article_stat" (
  "article_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "view" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "useful" TIMESTAMP(3),
  CONSTRAINT "Article_stat_pkey" PRIMARY KEY ("article_id", "session_id"),
  CONSTRAINT "Article_stat_article_id_fkey"
    FOREIGN KEY ("article_id") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Article_stat_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "Article_visitor_session"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Article_stat_article_id_view_idx"
  ON "Article_stat"("article_id", "view");

CREATE INDEX "Article_stat_article_id_useful_idx"
  ON "Article_stat"("article_id", "useful");
