-- CreateTable
CREATE TABLE "kg_skill_suggestions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "connector_id" TEXT,
    "title" TEXT NOT NULL,
    "when_to_use" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidence_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kg_skill_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kg_skill_suggestions_organization_id_idx" ON "kg_skill_suggestions"("organization_id");

-- AddForeignKey
ALTER TABLE "kg_skill_suggestions" ADD CONSTRAINT "kg_skill_suggestions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kg_skill_suggestions" ADD CONSTRAINT "kg_skill_suggestions_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "connectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

