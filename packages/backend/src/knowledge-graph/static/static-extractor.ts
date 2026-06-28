/**
 * Static KG extractor — turns a connector's tools into a draft entity graph.
 *
 * Pure: no DB, no DI. The KG service (later PR) calls this per connector and
 * upserts the result org-scoped; the observational layer then enriches it.
 */

import { extractEntity, singularize } from './entity-extraction';
import { fkCandidate, fkCandidatesFromText } from './fk-inference';
import {
  JsonSchemaLike,
  KgEdgeDraft,
  KgNodeDraft,
  StaticGraph,
  ToolLike,
} from './types';

const ENTITY_CONFIDENCE = 0.5;
const REFERENCES_CONFIDENCE = 0.5;
const PARENT_CHILD_CONFIDENCE = 0.6;
// FK references guessed from description prose are a weaker signal than a real
// parameter, so they rank below the min-confidence filter's mid-point.
const DESCRIPTION_REFERENCES_CONFIDENCE = 0.35;
// An FK in a RETURNED field is a solid structural signal (the tool literally
// emits the foreign key), on par with an input parameter reference.
const OUTPUT_REFERENCES_CONFIDENCE = 0.5;
// Data-flow inferred purely from schemas (output field of A == input/FK field of
// B). Useful but indirect, so mid-confidence.
const PRODUCES_CONSUMES_CONFIDENCE = 0.5;
// Cap how many field names we mine from one output schema (defends against
// pathological/huge inferred schemas).
const MAX_OUTPUT_FIELDS = 200;

/** Collect the distinct field NAMES a JSON-Schema (object/array, nested) emits. */
export function outputSchemaFieldNames(
  schema: JsonSchemaLike | null | undefined,
): string[] {
  const out = new Set<string>();
  const visit = (s: JsonSchemaLike | undefined, depth: number): void => {
    if (!s || typeof s !== 'object' || depth > 6 || out.size >= MAX_OUTPUT_FIELDS) return;
    if (s.properties) {
      for (const [name, child] of Object.entries(s.properties)) {
        if (out.size >= MAX_OUTPUT_FIELDS) break;
        out.add(name);
        visit(child, depth + 1);
      }
    }
    if (s.items) visit(s.items, depth + 1);
  };
  visit(schema ?? undefined, 0);
  return [...out];
}

export function buildStaticGraph(slug: string, tools: ToolLike[]): StaticGraph {
  const nodes = new Map<string, KgNodeDraft>();

  // Pass 1 — entities and their fields (union of input params across tools).
  for (const tool of tools) {
    const ent = extractEntity(tool.name, slug);
    if (!ent) continue;

    const node =
      nodes.get(ent.entity) ??
      {
        entity: ent.entity,
        label: ent.label,
        fields: [],
        outputFields: [],
        toolNames: [],
        source: 'static' as const,
        confidence: ENTITY_CONFIDENCE,
      };

    if (!node.toolNames.includes(tool.name)) node.toolNames.push(tool.name);

    const props = tool.parameters?.properties ?? {};
    for (const [fname, def] of Object.entries(props)) {
      if (!node.fields.some((f) => f.name === fname)) {
        node.fields.push({ name: fname, type: def?.type ?? 'unknown' });
      }
    }
    // Union of returned field names across the entity's tools.
    for (const fname of outputSchemaFieldNames(tool.outputSchema)) {
      if (!node.outputFields.includes(fname)) node.outputFields.push(fname);
    }
    nodes.set(ent.entity, node);
  }

  const entitySet = new Set(nodes.keys());
  const edges = new Map<string, KgEdgeDraft>();
  const addEdge = (
    source: string,
    target: string,
    kind: KgEdgeDraft['kind'],
    matchKey?: string,
    confidence?: number,
  ): void => {
    if (source === target) return;
    const key = `${source}|${target}|${kind}`;
    if (edges.has(key)) return;
    edges.set(key, {
      sourceEntity: source,
      targetEntity: target,
      kind,
      matchKey,
      source: 'static',
      confidence:
        confidence ??
        (kind === 'references' ? REFERENCES_CONFIDENCE : PARENT_CHILD_CONFIDENCE),
    });
  };

  // Pass 2a — references from FK-style parameters.
  for (const tool of tools) {
    const ent = extractEntity(tool.name, slug);
    if (!ent) continue;
    const props = tool.parameters?.properties ?? {};
    for (const fname of Object.keys(props)) {
      const target = fkCandidate(fname);
      if (target && entitySet.has(target)) {
        addEdge(ent.entity, target, 'references', fname);
      }
    }
  }

  // Pass 2a-bis — weaker references mined from the description prose (returned
  // fields the adapters don't declare structurally). Run after params so a real
  // parameter edge always wins the dedupe.
  for (const tool of tools) {
    const ent = extractEntity(tool.name, slug);
    if (!ent) continue;
    for (const target of fkCandidatesFromText(tool.description ?? '')) {
      if (entitySet.has(target)) {
        addEdge(ent.entity, target, 'references', undefined, DESCRIPTION_REFERENCES_CONFIDENCE);
      }
    }
  }

  // Pass 2b — parent/child for compound entities (`product_variation` <- `product`).
  for (const entity of entitySet) {
    if (!entity.includes('_')) continue;
    const parent = singularize(entity.split('_')[0]);
    if (entitySet.has(parent)) addEdge(parent, entity, 'parent_child');
  }

  // Pass 2c — references from FK-style fields in the RETURNED payload. A tool
  // that emits `customer_id` in its output points its entity at Customer, even
  // when no input parameter declares it.
  for (const node of nodes.values()) {
    for (const fname of node.outputFields) {
      const target = fkCandidate(fname);
      if (target && entitySet.has(target)) {
        addEdge(node.entity, target, 'references', fname, OUTPUT_REFERENCES_CONFIDENCE);
      }
    }
  }

  // Pass 2d — data-flow: an FK-style field a tool RETURNS that another entity's
  // tools take as INPUT (output property matches input property). Links the
  // producer entity to the consumer entity. Restricted to join-key fields so
  // generic names (status, name, …) never connect everything.
  const producersByField = new Map<string, Set<string>>(); // field -> producer entities
  const consumersByField = new Map<string, Set<string>>(); // field -> consumer entities
  const addTo = (m: Map<string, Set<string>>, field: string, entity: string) => {
    let s = m.get(field);
    if (!s) {
      s = new Set();
      m.set(field, s);
    }
    s.add(entity);
  };
  for (const node of nodes.values()) {
    for (const fname of node.outputFields) {
      if (fkCandidate(fname)) addTo(producersByField, fname, node.entity);
    }
    for (const f of node.fields) {
      if (fkCandidate(f.name)) addTo(consumersByField, f.name, node.entity);
    }
  }
  for (const [field, producers] of producersByField) {
    const consumers = consumersByField.get(field);
    if (!consumers) continue;
    for (const p of producers) {
      for (const c of consumers) {
        if (p === c) continue;
        addEdge(p, c, 'produces_consumes', field, PRODUCES_CONSUMES_CONFIDENCE);
      }
    }
  }

  return {
    connectorSlug: slug,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  };
}
