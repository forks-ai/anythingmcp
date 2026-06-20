/**
 * Static KG extractor — turns a connector's tools into a draft entity graph.
 *
 * Pure: no DB, no DI. The KG service (later PR) calls this per connector and
 * upserts the result org-scoped; the observational layer then enriches it.
 */

import { extractEntity, singularize } from './entity-extraction';
import { fkCandidate } from './fk-inference';
import { KgEdgeDraft, KgNodeDraft, StaticGraph, ToolLike } from './types';

const ENTITY_CONFIDENCE = 0.5;
const REFERENCES_CONFIDENCE = 0.5;
const PARENT_CHILD_CONFIDENCE = 0.6;

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
    nodes.set(ent.entity, node);
  }

  const entitySet = new Set(nodes.keys());
  const edges = new Map<string, KgEdgeDraft>();
  const addEdge = (
    source: string,
    target: string,
    kind: KgEdgeDraft['kind'],
    matchKey?: string,
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
      confidence: kind === 'references' ? REFERENCES_CONFIDENCE : PARENT_CHILD_CONFIDENCE,
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

  // Pass 2b — parent/child for compound entities (`product_variation` <- `product`).
  for (const entity of entitySet) {
    if (!entity.includes('_')) continue;
    const parent = singularize(entity.split('_')[0]);
    if (entitySet.has(parent)) addEdge(parent, entity, 'parent_child');
  }

  return {
    connectorSlug: slug,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  };
}
