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

describe('buildStaticGraph — outputSchema-driven edges', () => {
  // Two entities in one connector: a "search" tool returns customer ids, and the
  // "customer" tools take customer_id as input. Output field == input field.
  const tools: ToolLike[] = [
    {
      name: 'shop_search_orders',
      parameters: { properties: { query: { type: 'string' } } },
      outputSchema: {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            items: {
              type: 'object',
              properties: { order_id: { type: 'string' }, customer_id: { type: 'string' } },
            },
          },
        },
      },
    },
    {
      name: 'shop_get_customer',
      parameters: { properties: { customer_id: { type: 'string' } } },
      outputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
      },
    },
    {
      name: 'shop_get_order',
      parameters: { properties: { order_id: { type: 'string' } } },
    },
  ];
  const g = buildStaticGraph('shop', tools);

  it('records returned field names on the producing entity', () => {
    const order = g.nodes.find((n) => n.entity === 'order');
    expect(order?.outputFields).toEqual(
      expect.arrayContaining(['order_id', 'customer_id']),
    );
  });

  it('adds a references edge for an FK in the RETURNED payload', () => {
    // order's output carries customer_id -> order references customer
    expect(
      g.edges.some(
        (e) =>
          e.kind === 'references' &&
          e.sourceEntity === 'order' &&
          e.targetEntity === 'customer' &&
          e.matchKey === 'customer_id',
      ),
    ).toBe(true);
  });

  it('adds produces_consumes when an output field matches another entity input', () => {
    // order outputs customer_id; customer consumes customer_id as input
    expect(
      g.edges.some(
        (e) =>
          e.kind === 'produces_consumes' &&
          e.sourceEntity === 'order' &&
          e.targetEntity === 'customer' &&
          e.matchKey === 'customer_id',
      ),
    ).toBe(true);
  });

  it('does not create produces_consumes on generic (non-key) field names', () => {
    // `name` is generic and never a join key
    expect(g.edges.some((e) => e.matchKey === 'name')).toBe(false);
  });

  it('is a no-op for tools without an outputSchema (back-compat)', () => {
    const plain = buildStaticGraph('shop', [
      { name: 'shop_get_order', parameters: { properties: { order_id: { type: 'string' } } } },
    ]);
    expect(plain.nodes[0].outputFields).toEqual([]);
    expect(plain.edges.every((e) => e.kind !== 'produces_consumes')).toBe(true);
  });
});
