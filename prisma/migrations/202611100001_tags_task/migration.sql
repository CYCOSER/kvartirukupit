CREATE TABLE "tags_task" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "params" JSONB NOT NULL,
  "tag_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tags_task_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tags_task_type_check" CHECK ("type" IN ('complex', 'apartment', 'article')),
  CONSTRAINT "tags_task_tag_id_fkey"
    FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "tags_task_tag_id_idx" ON "tags_task"("tag_id");
