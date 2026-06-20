-- JSON Schema of a tool's response, surfaced to MCP clients as outputSchema.
ALTER TABLE "mcp_tools" ADD COLUMN IF NOT EXISTS "output_schema" JSONB;
