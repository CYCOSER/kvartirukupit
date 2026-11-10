ALTER TABLE "Article_visitor_session"
  ADD COLUMN "expired_at" TIMESTAMP(3) NOT NULL
  DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours');

ALTER TABLE "Article_visitor_session"
  ALTER COLUMN "expired_at" DROP DEFAULT;
