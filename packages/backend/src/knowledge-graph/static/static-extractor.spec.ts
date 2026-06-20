import { getAdapter } from '../../adapters/catalog';
import { buildStaticGraph } from './static-extractor';
import { StaticGraph, ToolLike } from './types';

function graphFor(slug: string): StaticGraph {
  const adapter = getAdapter(slug);
  if (!adapter) throw new Error(`adapter ${slug} not found`);
  return buildStaticGraph(adapter.slug, adapter.tools as ToolLike[]);
}

describe('buildStaticGraph — real catalog adapters', () => {
  describe('pipedrive (CRM)', () => {
    const g = graphFor('pipedrive');
    const entities = new Set(g.nodes.map((n) => n.entity));

    it('extracts the core CRM entities', () => {
      for (const e of ['deal', 'person', 'organization', 'pipeline', 'stage']) {
        expect(entities.has(e)).toBe(true);
      }
    });

    it('drops metadata/utility tools (no *_field entities)', () => {
      for (const e of entities) expect(e.endsWith('_field')).toBe(false);
      expect(entities.has('current_user')).toBe(false);
    });

    it('infers FK references between entities (deal -> person/organization)', () => {
      const hasEdge = (s: string, t: string) =>
        g.edges.some(
          (e) => e.kind === 'references' && e.sourceEntity === s && e.targetEntity === t,
        );
      expect(hasEdge('deal', 'person')).toBe(true);
      expect(hasEdge('deal', 'organization')).toBe(true);
    });

    it('does not connect on the generic owner field (owner is not an entity)', () => {
      expect(entities.has('owner')).toBe(false);
      expect(g.edges.some((e) => e.targetEntity === 'owner')).toBe(false);
    });
  });

  describe('graph integrity (sampled connectors)', () => {
    it.each(['pipedrive', 'woocommerce', 'zendesk', 'mollie', 'trello', 'clickup'])(
      '%s: every edge endpoint exists, no self-loops, no generic match keys',
      (slug) => {
        const g = graphFor(slug);
        const entities = new Set(g.nodes.map((n) => n.entity));
        for (const e of g.edges) {
          expect(entities.has(e.sourceEntity)).toBe(true);
          expect(entities.has(e.targetEntity)).toBe(true);
          expect(e.sourceEntity).not.toBe(e.targetEntity);
          if (e.matchKey) {
            expect(['id', 'name', 'email', 'status']).not.toContain(e.matchKey);
          }
        }
        // A real connector should yield at least a couple of entities.
        expect(g.nodes.length).toBeGreaterThan(1);
      },
    );
  });

  it('woocommerce: product_variation is a child of product', () => {
    const g = graphFor('woocommerce');
    const entities = new Set(g.nodes.map((n) => n.entity));
    if (entities.has('product_variation')) {
      expect(
        g.edges.some(
          (e) =>
            e.kind === 'parent_child' &&
            e.sourceEntity === 'product' &&
            e.targetEntity === 'product_variation',
        ),
      ).toBe(true);
    }
  });
});
