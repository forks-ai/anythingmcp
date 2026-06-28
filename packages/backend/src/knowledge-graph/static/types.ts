/**
 * Knowledge Graph — static layer types.
 *
 * The static extractor is a PURE module (no NestJS DI, no DB): it turns a
 * connector's tool definitions into a draft entity graph using only tool
 * names and parameter names. It is the "cold-start" layer — it produces a
 * usable graph the moment a connector is installed, before any traffic.
 * The observational layer (from tool_invocations) later raises/corrects the
 * confidence of these drafts.
 *
 * Drafts intentionally carry no ids / organizationId — persistence (org
 * scoping, upsert, RLS) is the caller's concern.
 */

export type KgEdgeKind =
  | 'references'
  | 'parent_child'
  // Data-flow inferred from schemas: an entity whose tools RETURN a field that
  // another entity's tools take as a (FK-style) input parameter.
  | 'produces_consumes';

export interface KgFieldDraft {
  name: string;
  type: string;
}

export interface KgNodeDraft {
  /** Normalized singular entity noun, e.g. "deal", "product_variation". */
  entity: string;
  /** Human-friendly label, e.g. "Product variation". */
  label: string;
  /** Union of input parameters across the entity's tools (the writable surface). */
  fields: KgFieldDraft[];
  /** Union of field NAMES the entity's tools RETURN (from their outputSchema).
   *  Drives data-flow edges and feeds the LLM enrichment. */
  outputFields: string[];
  /** Tool names that touch this entity (used later for `how_to_obtain`). */
  toolNames: string[];
  source: 'static';
  confidence: number;
}

export interface KgEdgeDraft {
  sourceEntity: string;
  targetEntity: string;
  kind: KgEdgeKind;
  /** For `references`: the FK-style parameter that links the two entities. */
  matchKey?: string;
  source: 'static';
  confidence: number;
}

export interface StaticGraph {
  connectorSlug: string;
  nodes: KgNodeDraft[];
  edges: KgEdgeDraft[];
}

/** Minimal shape the extractor needs from a tool definition. */
export interface ToolLike {
  name: string;
  /** Free-text description — often lists the fields a call RETURNS, which the
   *  adapters don't declare structurally. Mined for extra FK-style edges. */
  description?: string;
  parameters?: {
    properties?: Record<string, { type?: string } | undefined>;
  };
  /** JSON Schema of the tool's response (mcp_tools.output_schema), when known.
   *  Property names are mined for data-flow edges. */
  outputSchema?: JsonSchemaLike | null;
}

/** Minimal JSON-Schema shape we walk to collect returned field names. */
export interface JsonSchemaLike {
  type?: string;
  properties?: Record<string, JsonSchemaLike | undefined>;
  items?: JsonSchemaLike;
}
