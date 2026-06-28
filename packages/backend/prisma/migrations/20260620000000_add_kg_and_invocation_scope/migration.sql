-- CreateEnum
CREATE TYPE "KgSource" AS ENUM ('STATIC', 'OBSERVED', 'MANUAL');

-- AlterTable: denormalized tenant + connector scope + proxy/cost metering on the audit log
ALTER TABLE "tool_invocations" ADD COLUMN     "connector_id" TEXT,
ADD COLUMN     "cost_micros" INTEGER,
ADD COLUMN     "organization_id" TEXT,
ADD COLUMN     "used_proxy" BOOLEAN NOT NULL DEFAULT false;

-- Backfill org/connector scope from tool -> connector. On a large prod table run
-- this in batches; on dev it is a single statement.
UPDATE "tool_invocations" ti
SET "organization_id" = c."organization_id",
    "connector_id" = c."id"
FROM "mcp_tools" t
JOIN "connectors" c ON c."id" = t."connector_id"
WHERE t."id" = ti."tool_id" AND ti."organization_id" IS NULL;

-- CreateTable
CREATE TABLE "kg_nodes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "connector_id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "tool_names" JSONB NOT NULL DEFAULT '[]',
    "source" "KgSource" NOT NULL DEFAULT 'STATIC',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "observations" INTEGER NOT NULL DEFAULT 0,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kg_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kg_edges" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "source_node_id" TEXT NOT NULL,
    "target_node_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "match_key" TEXT,
    "evidence_tools" JSONB,
    "source" "KgSource" NOT NULL DEFAULT 'STATIC',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "observations" INTEGER NOT NULL DEFAULT 0,
    "is_manual" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kg_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kg_connector_state" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "connector_id" TEXT NOT NULL,
    "static_hash" TEXT,
    "last_static_at" TIMESTAMP(3),
    "last_observed_at" TIMESTAMP(3),

    CONSTRAINT "kg_connector_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kg_value_seen" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "connector_id" TEXT NOT NULL,
    "value_hash" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kg_value_seen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kg_nodes_organization_id_idx" ON "kg_nodes"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "kg_nodes_organization_id_connector_id_entity_key" ON "kg_nodes"("organization_id", "connector_id", "entity");

-- CreateIndex
CREATE INDEX "kg_edges_organization_id_idx" ON "kg_edges"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "kg_edges_organization_id_source_node_id_target_node_id_kind_key" ON "kg_edges"("organization_id", "source_node_id", "target_node_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "kg_connector_state_connector_id_key" ON "kg_connector_state"("connector_id");

-- CreateIndex
CREATE INDEX "kg_connector_state_organization_id_idx" ON "kg_connector_state"("organization_id");

-- CreateIndex
CREATE INDEX "kg_value_seen_organization_id_value_hash_idx" ON "kg_value_seen"("organization_id", "value_hash");

-- CreateIndex
CREATE INDEX "kg_value_seen_seen_at_idx" ON "kg_value_seen"("seen_at");

-- CreateIndex
CREATE INDEX "tool_invocations_organization_id_created_at_idx" ON "tool_invocations"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "tool_invocations_connector_id_created_at_idx" ON "tool_invocations"("connector_id", "created_at");

-- AddForeignKey
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "connectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kg_nodes" ADD CONSTRAINT "kg_nodes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kg_nodes" ADD CONSTRAINT "kg_nodes_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kg_edges" ADD CONSTRAINT "kg_edges_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kg_edges" ADD CONSTRAINT "kg_edges_source_node_id_fkey" FOREIGN KEY ("source_node_id") REFERENCES "kg_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kg_edges" ADD CONSTRAINT "kg_edges_target_node_id_fkey" FOREIGN KEY ("target_node_id") REFERENCES "kg_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kg_connector_state" ADD CONSTRAINT "kg_connector_state_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kg_connector_state" ADD CONSTRAINT "kg_connector_state_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kg_value_seen" ADD CONSTRAINT "kg_value_seen_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

