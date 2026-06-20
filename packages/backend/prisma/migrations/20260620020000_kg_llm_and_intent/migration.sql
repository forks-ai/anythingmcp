-- LLM enrichment + intent capture support.
ALTER TYPE "KgSource" ADD VALUE IF NOT EXISTS 'LLM';

-- Rationale for a relationship (LLM-generated or human note).
ALTER TABLE "kg_edges" ADD COLUMN IF NOT EXISTS "note" TEXT;

-- Natural-language user intent that led to a tool call (opt-in capture).
ALTER TABLE "tool_invocations" ADD COLUMN IF NOT EXISTS "intent" TEXT;
