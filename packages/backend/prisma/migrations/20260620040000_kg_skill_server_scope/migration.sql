-- Allow a skill suggestion to be scoped to a whole MCP server (combined context
-- of all its connectors), not just a single connector.
ALTER TABLE "kg_skill_suggestions" ADD COLUMN IF NOT EXISTS "mcp_server_id" TEXT;

ALTER TABLE "kg_skill_suggestions"
  ADD CONSTRAINT "kg_skill_suggestions_mcp_server_id_fkey"
  FOREIGN KEY ("mcp_server_id") REFERENCES "mcp_server_configs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
