/**
 * Dev preview of the static KG extractor across the whole catalog.
 *
 *   npx ts-node src/knowledge-graph/static/preview.ts            # summary table
 *   npx ts-node src/knowledge-graph/static/preview.ts pipedrive  # full graph for one connector
 *
 * Pure read of the adapter catalog — no DB, no server bootstrap.
 */

import { getAdapter, listAdapters } from '../../adapters/catalog';
import { buildStaticGraph } from './static-extractor';
import { ToolLike } from './types';

function previewOne(slug: string): void {
  const adapter = getAdapter(slug);
  if (!adapter) {
    console.error(`No adapter "${slug}".`);
    process.exit(1);
  }
  const g = buildStaticGraph(adapter.slug, adapter.tools as ToolLike[]);
  console.log(`\n# ${adapter.name} (${slug}) — ${adapter.tools.length} tools\n`);
  console.log(`Entities (${g.nodes.length}):`);
  for (const n of g.nodes) {
    console.log(`  • ${n.entity}  [${n.fields.length} fields, ${n.toolNames.length} tools]`);
  }
  console.log(`\nEdges (${g.edges.length}):`);
  for (const e of g.edges) {
    const via = e.matchKey ? ` via ${e.matchKey}` : '';
    console.log(`  ${e.sourceEntity} --${e.kind}${via}--> ${e.targetEntity}  (${e.confidence})`);
  }
}

function previewAll(): void {
  const rows = listAdapters()
    .map((a) => {
      const adapter = getAdapter(a.slug)!;
      const g = buildStaticGraph(a.slug, adapter.tools as ToolLike[]);
      return {
        slug: a.slug,
        tools: adapter.tools.length,
        entities: g.nodes.length,
        edges: g.edges.length,
      };
    })
    .sort((a, b) => b.edges - a.edges);

  const totals = rows.reduce(
    (acc, r) => ({
      tools: acc.tools + r.tools,
      entities: acc.entities + r.entities,
      edges: acc.edges + r.edges,
    }),
    { tools: 0, entities: 0, edges: 0 },
  );

  console.log('slug'.padEnd(26), 'tools'.padStart(6), 'entities'.padStart(9), 'edges'.padStart(6));
  for (const r of rows) {
    console.log(
      r.slug.padEnd(26),
      String(r.tools).padStart(6),
      String(r.entities).padStart(9),
      String(r.edges).padStart(6),
    );
  }
  console.log(
    '\nTOTAL'.padEnd(26),
    String(totals.tools).padStart(6),
    String(totals.entities).padStart(9),
    String(totals.edges).padStart(6),
    `  across ${rows.length} connectors`,
  );
}

const arg = process.argv[2];
if (arg) previewOne(arg);
else previewAll();
