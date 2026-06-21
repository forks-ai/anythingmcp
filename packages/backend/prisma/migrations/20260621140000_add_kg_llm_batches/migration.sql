CREATE TABLE IF NOT EXISTS "kg_llm_batches" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "context" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kg_llm_batches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "kg_llm_batches_status_idx" ON "kg_llm_batches"("status");
