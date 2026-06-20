import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { KgStaticService } from '../../knowledge-graph/kg-static.service';
import { KgObservationalService } from '../../knowledge-graph/kg-observational.service';

function intEnv(name: string, fallback: number): number {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Cloud-only maintenance pass for the Knowledge Graph + audit log.
 *
 *  1. For a capped, staleness-ordered batch of orgs: refresh the static layer
 *     (incremental) and ingest new tool_invocations into the observational layer.
 *  2. Prune kg_value_seen rows past their TTL (hashes are short-lived).
 *  3. Retention: delete tool_invocations older than INVOCATION_RETENTION_DAYS —
 *     AFTER observational ingest, so the graph consumes rows before they're purged.
 */
@Injectable()
export class KgCronService {
  private readonly logger = new Logger(KgCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kgStatic: KgStaticService,
    private readonly kgObservational: KgObservationalService,
  ) {}

  async run(): Promise<{
    orgsProcessed: number;
    orgsTotal: number;
    nodes: number;
    edges: number;
    invocations: number;
    prunedValueSeen: number;
    prunedInvocations: number;
  }> {
    const maxOrgs = intEnv('KG_CRON_MAX_ORGS', 50);

    // Orgs that have at least one connector. Staleness-ordered: those whose KG
    // was observed longest ago (or never) come first.
    const states = await this.prisma.kgConnectorState.findMany({
      select: { organizationId: true, lastObservedAt: true },
    });
    const oldestByOrg = new Map<string, number>();
    for (const s of states) {
      const t = s.lastObservedAt ? s.lastObservedAt.getTime() : 0;
      const cur = oldestByOrg.get(s.organizationId);
      if (cur === undefined || t < cur) oldestByOrg.set(s.organizationId, t);
    }
    const allOrgs = (
      await this.prisma.connector.findMany({
        distinct: ['organizationId'],
        select: { organizationId: true },
      })
    ).map((c) => c.organizationId);

    const ordered = allOrgs.sort(
      (a, b) => (oldestByOrg.get(a) ?? 0) - (oldestByOrg.get(b) ?? 0),
    );
    const batch = ordered.slice(0, maxOrgs);

    let nodes = 0;
    let edges = 0;
    let invocations = 0;
    for (const orgId of batch) {
      try {
        const s = await this.kgStatic.syncOrganization(orgId);
        const o = await this.kgObservational.ingestOrganization(orgId);
        nodes += s.nodes;
        edges += s.edges;
        invocations += o.invocations;
      } catch (e: any) {
        this.logger.warn(`KG cron failed for org ${orgId}: ${e.message}`);
      }
    }

    if (ordered.length > batch.length) {
      this.logger.log(
        `KG cron processed ${batch.length}/${ordered.length} orgs this run (capped at ${maxOrgs}).`,
      );
    }

    const prunedValueSeen = await this.pruneValueSeen();
    const prunedInvocations = await this.retention();

    return {
      orgsProcessed: batch.length,
      orgsTotal: ordered.length,
      nodes,
      edges,
      invocations,
      prunedValueSeen,
      prunedInvocations,
    };
  }

  /** Drop hashed identifier rows older than the TTL. */
  private async pruneValueSeen(): Promise<number> {
    const days = intEnv('KG_VALUE_TTL_DAYS', 30);
    if (days <= 0) return 0;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.kgValueSeen.deleteMany({
      where: { seenAt: { lt: cutoff } },
    });
    return count;
  }

  /** Delete audit rows older than the retention window (cloud-only). */
  private async retention(): Promise<number> {
    const days = intEnv('INVOCATION_RETENTION_DAYS', 90);
    if (days <= 0) return 0;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.toolInvocation.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (count > 0) this.logger.log(`Retention: pruned ${count} tool_invocations older than ${days}d.`);
    return count;
  }
}
