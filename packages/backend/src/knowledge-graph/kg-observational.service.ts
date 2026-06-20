import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { extractEntity } from './static/entity-extraction';
import { deriveSlug } from './kg-static.service';
import { extractIdentifiers, hashValue } from './identifier';

const MAX_INVOCATIONS_PER_RUN = 2000;
const MAX_PAIRS_PER_HASH = 6; // cap fan-out per shared value

/**
 * Observational KG layer: learns relationships from real tool_invocations.
 *
 *   produces_consumes — a value that a tool OUTPUT also appears as another
 *                       tool's INPUT (data flow; valuable even single-connector).
 *   same_identity     — the same value seen across two connectors (suggested,
 *                       low confidence, awaits manual confirmation).
 *
 * PII-safe: only HMAC'd (per-org) identifier hashes are stored in kg_value_seen,
 * never raw values. Tenant isolation is application-layer (every query carries
 * organizationId). Idempotent + incremental via per-connector watermark.
 */
@Injectable()
export class KgObservationalService {
  private readonly logger = new Logger(KgObservationalService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ingestOrganization(
    organizationId: string,
  ): Promise<{ invocations: number; edges: number }> {
    // Per-connector slug + watermark.
    const connectors = await this.prisma.connector.findMany({
      where: { organizationId },
      select: { id: true, tools: { select: { name: true } } },
    });
    const slugByConnector = new Map(
      connectors.map((c) => [c.id, deriveSlug(c.tools.map((t) => t.name))]),
    );
    const states = await this.prisma.kgConnectorState.findMany({
      where: { organizationId },
      select: { connectorId: true, lastObservedAt: true },
    });
    const watermark = new Map(states.map((s) => [s.connectorId, s.lastObservedAt]));
    const floor = states
      .map((s) => s.lastObservedAt)
      .filter((d): d is Date => !!d)
      .reduce((min, d) => (d < min ? d : min), new Date(0));

    const invocations = await this.prisma.toolInvocation.findMany({
      where: {
        organizationId,
        connectorId: { not: null },
        createdAt: { gt: floor },
      },
      select: {
        id: true,
        connectorId: true,
        createdAt: true,
        input: true,
        output: true,
        tool: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_INVOCATIONS_PER_RUN,
    });

    const newHashes = new Set<string>();
    const valueRows: Array<{
      organizationId: string;
      connectorId: string;
      valueHash: string;
      entity: string;
      field: string;
      direction: string;
    }> = [];
    const maxTsByConnector = new Map<string, Date>();

    for (const inv of invocations) {
      const connectorId = inv.connectorId!;
      // Skip invocations already covered by this connector's watermark.
      const wm = watermark.get(connectorId);
      if (wm && inv.createdAt <= wm) continue;

      const slug = slugByConnector.get(connectorId) ?? '';
      const ent = extractEntity(inv.tool?.name ?? '', slug);
      if (!ent) continue;

      const prevMax = maxTsByConnector.get(connectorId);
      if (!prevMax || inv.createdAt > prevMax) {
        maxTsByConnector.set(connectorId, inv.createdAt);
      }

      const collect = (payload: unknown, direction: 'input' | 'output') => {
        for (const { field, value } of extractIdentifiers(payload)) {
          const valueHash = hashValue(organizationId, value);
          newHashes.add(valueHash);
          valueRows.push({
            organizationId,
            connectorId,
            valueHash,
            entity: ent.entity,
            field,
            direction,
          });
        }
      };
      collect(inv.input, 'input');
      collect(inv.output, 'output');
    }

    if (valueRows.length) {
      await this.prisma.kgValueSeen.createMany({ data: valueRows });
    }

    const edges = newHashes.size
      ? await this.correlate(organizationId, [...newHashes])
      : 0;

    // Advance per-connector watermark.
    for (const [connectorId, ts] of maxTsByConnector) {
      await this.prisma.kgConnectorState.upsert({
        where: { connectorId },
        create: { organizationId, connectorId, lastObservedAt: ts },
        update: { lastObservedAt: ts },
      });
    }

    this.logger.debug(
      `KG observational ${organizationId}: ${invocations.length} invocations, ${edges} edges`,
    );
    return { invocations: invocations.length, edges };
  }

  /** Correlate value occurrences into produces_consumes + same_identity edges. */
  private async correlate(
    organizationId: string,
    hashes: string[],
  ): Promise<number> {
    const rows = await this.prisma.kgValueSeen.findMany({
      where: { organizationId, valueHash: { in: hashes } },
      select: {
        valueHash: true,
        connectorId: true,
        entity: true,
        field: true,
        direction: true,
      },
    });

    const byHash = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = byHash.get(r.valueHash) ?? [];
      list.push(r);
      byHash.set(r.valueHash, list);
    }

    const nodeCache = new Map<string, string>(); // `${connectorId}::${entity}` -> nodeId
    let edgeCount = 0;

    for (const occ of byHash.values()) {
      const producers = occ.filter((o) => o.direction === 'output').slice(0, MAX_PAIRS_PER_HASH);
      const consumers = occ.filter((o) => o.direction === 'input').slice(0, MAX_PAIRS_PER_HASH);

      // produces_consumes: an output value later used as an input.
      for (const p of producers) {
        for (const c of consumers) {
          if (p.connectorId === c.connectorId && p.entity === c.entity) continue;
          const src = await this.nodeId(nodeCache, organizationId, p.connectorId, p.entity);
          const tgt = await this.nodeId(nodeCache, organizationId, c.connectorId, c.entity);
          if (!src || !tgt || src === tgt) continue;
          await this.bumpEdge(organizationId, src, tgt, 'produces_consumes', {
            matchKey: c.field,
            base: 0.55,
            cap: 0.95,
            status: 'active',
          });
          // The data confirms any static FK guess between the same nodes.
          await this.prisma.kgEdge.updateMany({
            where: { organizationId, sourceNodeId: src, targetNodeId: tgt, kind: 'references', source: 'STATIC' },
            data: { source: 'OBSERVED', confidence: 0.8, lastSeenAt: new Date() },
          });
          edgeCount++;
        }
      }

      // same_identity: same value across two distinct connectors.
      const connectors = [...new Set(occ.map((o) => o.connectorId))];
      if (connectors.length >= 2) {
        for (let i = 0; i < occ.length; i++) {
          for (let j = i + 1; j < occ.length; j++) {
            const a = occ[i];
            const b = occ[j];
            if (a.connectorId === b.connectorId) continue;
            const na = await this.nodeId(nodeCache, organizationId, a.connectorId, a.entity);
            const nb = await this.nodeId(nodeCache, organizationId, b.connectorId, b.entity);
            if (!na || !nb || na === nb) continue;
            const [src, tgt] = na < nb ? [na, nb] : [nb, na];
            await this.bumpEdge(organizationId, src, tgt, 'same_identity', {
              matchKey: a.field === b.field ? a.field : undefined,
              base: 0.2,
              cap: 0.6,
              status: 'suggested',
            });
            edgeCount++;
          }
        }
      }
    }
    return edgeCount;
  }

  private async nodeId(
    cache: Map<string, string>,
    organizationId: string,
    connectorId: string,
    entity: string,
  ): Promise<string | null> {
    const key = `${connectorId}::${entity}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const node = await this.prisma.kgNode.upsert({
      where: { organizationId_connectorId_entity: { organizationId, connectorId, entity } },
      create: {
        organizationId,
        connectorId,
        entity,
        label: entity.charAt(0).toUpperCase() + entity.slice(1).replace(/_/g, ' '),
        source: 'OBSERVED',
        confidence: 0.4,
      },
      update: {},
      select: { id: true },
    });
    cache.set(key, node.id);
    return node.id;
  }

  private async bumpEdge(
    organizationId: string,
    sourceNodeId: string,
    targetNodeId: string,
    kind: string,
    opts: { matchKey?: string; base: number; cap: number; status: string },
  ): Promise<void> {
    const existing = await this.prisma.kgEdge.findUnique({
      where: {
        organizationId_sourceNodeId_targetNodeId_kind: {
          organizationId,
          sourceNodeId,
          targetNodeId,
          kind,
        },
      },
      select: { id: true, observations: true, isManual: true, status: true },
    });
    if (!existing) {
      await this.prisma.kgEdge.create({
        data: {
          organizationId,
          sourceNodeId,
          targetNodeId,
          kind,
          matchKey: opts.matchKey,
          source: 'OBSERVED',
          confidence: Math.min(opts.cap, opts.base),
          observations: 1,
          status: opts.status,
        },
      });
      return;
    }
    const observations = existing.observations + 1;
    await this.prisma.kgEdge.update({
      where: { id: existing.id },
      data: {
        observations,
        confidence: Math.min(opts.cap, opts.base + 0.05 * (observations - 1)),
        source: 'OBSERVED',
        matchKey: opts.matchKey,
        lastSeenAt: new Date(),
        // Never silently re-open a link the user rejected, nor downgrade a confirmed one.
        ...(existing.isManual || existing.status === 'rejected'
          ? {}
          : { status: opts.status }),
      },
    });
  }
}
