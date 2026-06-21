import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { KgLlmService } from './kg-llm.service';
import { chatJson, resolveLlmConfig } from './llm-client';
import { maybeRedactIntent } from './redact';

const MAX_INTENTS = 200;

const JSON_SHAPE =
  'Return STRICT JSON: {"skills":[{"title":"<short>","whenToUse":"<when this rule applies>","instruction":"<imperative guidance for the agent>","confidence":0..1,"evidenceCount":<int>}]}.';

const GROUNDING =
  'Ground EVERY skill in the supplied intents (and connectors). Do not invent rules from general knowledge, and never reproduce any example wording from these instructions. If the inputs show no clear, recurring need, return {"skills":[]}.';

const CONNECTOR_PROMPT = `You improve an AI tool-integration platform by turning real user requests ("intents") into reusable "skills" — short corrections or domain rules that make future tool calls behave the way the user actually wants.

You receive recent tool calls, each with: the user's intent, the tool name, its connector, and whether it succeeded.

Look for RECURRING or HIGH-VALUE patterns in the intents where a standing rule would have produced the result the user actually asked for (e.g. a correction the user had to make).

${JSON_SHAPE}

Each skill also has a "connector": "<connector name or null>". Rules:
- Propose at most 6 skills. Prefer specific, actionable rules.
- Only use connector names that appear in the input (or null).
- ${GROUNDING}`;

const SERVER_PROMPT = `You configure a single MCP server that combines SEVERAL connectors into one assistant. Turn real user requests ("intents") into reusable cross-connector "skills" — rules that apply to the WHOLE server, understanding how its connectors relate.

You receive: the server's connectors with their entities, and recent tool calls (intent, tool, connector, success).

Look for HIGH-VALUE rules grounded in the intents that span or coordinate connectors, or encode a domain convention the user explicitly stated or corrected.

${JSON_SHAPE}
Rules: at most 6 server-wide skills, specific and actionable. ${GROUNDING}`;

/**
 * Turns captured user intents into reviewable skill suggestions via the LLM.
 * Scope is a single connector OR a whole MCP server (combined context of all its
 * connectors). Opt-in (requires AI enrichment). Applied skills are composed into
 * the MCP server's instructions dynamically — so editing or deleting one takes
 * effect immediately, without mutating the connector/server instruction blobs.
 */
@Injectable()
export class KgSkillService {
  private readonly logger = new Logger(KgSkillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: KgLlmService,
  ) {}

  async generate(
    organizationId: string,
    opts?: { mcpServerId?: string },
  ): Promise<{ created: number; model?: string; usage?: any }> {
    if (!(await this.llm.isEnabled(organizationId))) {
      throw new ConflictException('AI features are disabled for this workspace.');
    }
    return opts?.mcpServerId
      ? this.generateForServer(organizationId, opts.mcpServerId)
      : this.generateForConnectors(organizationId);
  }

  private async generateForConnectors(organizationId: string) {
    const cfg = resolveLlmConfig()!;
    const invocations = await this.prisma.toolInvocation.findMany({
      where: { organizationId, intent: { not: null } },
      select: {
        intent: true,
        status: true,
        tool: { select: { name: true, connector: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_INTENTS,
    });
    if (invocations.length === 0) return { created: 0, model: cfg.model };

    const calls = invocations.map((i) => ({
      intent: maybeRedactIntent((i.intent ?? '').slice(0, 400)),
      tool: i.tool?.name ?? 'unknown',
      connector: i.tool?.connector?.name ?? '',
      ok: i.status === 'SUCCESS',
    }));

    const { json, usage } = await chatJson(cfg, CONNECTOR_PROMPT, JSON.stringify({ calls }), 1500);
    const skills: any[] = Array.isArray(json?.skills) ? json.skills : [];

    const connectors = await this.prisma.connector.findMany({
      where: { organizationId },
      select: { id: true, name: true },
    });
    const idByName = new Map(connectors.map((c) => [c.name.toLowerCase(), c.id]));

    await this.prisma.kgSkillSuggestion.deleteMany({
      where: { organizationId, status: 'pending', mcpServerId: null },
    });

    let created = 0;
    for (const s of skills) {
      const connectorId =
        typeof s?.connector === 'string' ? (idByName.get(s.connector.toLowerCase()) ?? null) : null;
      if (await this.insertSkill(organizationId, { connectorId }, s)) created++;
    }
    this.logger.log(`KG skills (connectors) ${organizationId}: ${created} from ${invocations.length} intents`);
    return { created, model: cfg.model, usage };
  }

  private async generateForServer(organizationId: string, mcpServerId: string) {
    const cfg = resolveLlmConfig()!;
    const server = await this.prisma.mcpServerConfig.findUnique({
      where: { id: mcpServerId },
      select: { id: true, name: true, organizationId: true },
    });
    if (!server || server.organizationId !== organizationId) {
      throw new NotFoundException('MCP server not found.');
    }

    const links = await this.prisma.mcpServerConnector.findMany({
      where: { mcpServerId },
      select: { connectorId: true, connector: { select: { name: true } } },
    });
    const connectorIds = links.map((l) => l.connectorId);

    const nodes = await this.prisma.kgNode.findMany({
      where: { organizationId, connectorId: { in: connectorIds.length ? connectorIds : ['__none__'] } },
      select: { entity: true, connector: { select: { name: true } } },
    });
    const connectorsContext = links.map((l) => ({
      connector: l.connector?.name ?? '',
      entities: nodes.filter((n) => n.connector?.name === l.connector?.name).map((n) => n.entity),
    }));

    const invocations = await this.prisma.toolInvocation.findMany({
      where: { organizationId, mcpServerId, intent: { not: null } },
      select: {
        intent: true,
        status: true,
        tool: { select: { name: true, connector: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_INTENTS,
    });

    const calls = invocations.map((i) => ({
      intent: maybeRedactIntent((i.intent ?? '').slice(0, 400)),
      tool: i.tool?.name ?? 'unknown',
      connector: i.tool?.connector?.name ?? '',
      ok: i.status === 'SUCCESS',
    }));

    const { json, usage } = await chatJson(
      cfg,
      SERVER_PROMPT,
      JSON.stringify({ server: server.name, connectors: connectorsContext, calls }),
      1500,
    );
    const skills: any[] = Array.isArray(json?.skills) ? json.skills : [];

    await this.prisma.kgSkillSuggestion.deleteMany({
      where: { organizationId, status: 'pending', mcpServerId },
    });

    let created = 0;
    for (const s of skills) {
      if (await this.insertSkill(organizationId, { mcpServerId }, s)) created++;
    }
    this.logger.log(`KG skills (server ${server.name}) ${organizationId}: ${created}`);
    return { created, model: cfg.model, usage };
  }

  private async insertSkill(
    organizationId: string,
    scope: { connectorId?: string | null; mcpServerId?: string | null },
    s: any,
  ): Promise<boolean> {
    const title = typeof s?.title === 'string' ? s.title.slice(0, 160) : null;
    const instruction = typeof s?.instruction === 'string' ? s.instruction.slice(0, 2000) : null;
    if (!title || !instruction) return false;
    await this.prisma.kgSkillSuggestion.create({
      data: {
        organizationId,
        connectorId: scope.connectorId ?? null,
        mcpServerId: scope.mcpServerId ?? null,
        title,
        whenToUse: typeof s?.whenToUse === 'string' ? s.whenToUse.slice(0, 1000) : '',
        instruction,
        confidence: Math.max(0, Math.min(1, Number(s?.confidence) || 0.5)),
        evidenceCount: Math.max(0, Math.min(9999, parseInt(s?.evidenceCount, 10) || 0)),
      },
    });
    return true;
  }

  async list(organizationId: string) {
    return this.prisma.kgSkillSuggestion.findMany({
      where: { organizationId },
      orderBy: [{ status: 'asc' }, { confidence: 'desc' }],
      include: {
        connector: { select: { name: true } },
        mcpServer: { select: { name: true } },
      },
    });
  }

  /** Active skills composed into an MCP server's instructions at serve time. */
  async activeSkillsText(serverId: string, connectorIds: string[]): Promise<string | null> {
    const skills = await this.prisma.kgSkillSuggestion.findMany({
      where: {
        status: 'applied',
        OR: [
          { mcpServerId: serverId },
          { connectorId: { in: connectorIds.length ? connectorIds : ['__none__'] } },
        ],
      },
      select: { title: true, whenToUse: true, instruction: true },
      orderBy: { confidence: 'desc' },
    });
    if (!skills.length) return null;
    const body = skills
      .map((s) => `- ${s.title}${s.whenToUse ? ` (when: ${s.whenToUse})` : ''}: ${s.instruction}`)
      .join('\n');
    return `## Workspace skills\n${body}`;
  }

  /**
   * Create a skill by hand (not AI-generated). Scoped to a single connector OR a
   * whole MCP server (mutually exclusive). Defaults to `applied` so it is live
   * for MCP immediately — a deliberately authored rule needs no review step.
   */
  async create(
    organizationId: string,
    body: {
      title: string;
      whenToUse?: string;
      instruction: string;
      connectorId?: string | null;
      mcpServerId?: string | null;
      status?: string;
    },
  ) {
    const title = (body.title || '').trim().slice(0, 160);
    const instruction = (body.instruction || '').trim().slice(0, 2000);
    if (!title || !instruction) {
      throw new ConflictException('A skill needs a title and an instruction.');
    }
    // Validate the chosen scope belongs to this org (fail closed).
    let connectorId: string | null = null;
    let mcpServerId: string | null = null;
    if (body.mcpServerId) {
      const srv = await this.prisma.mcpServerConfig.findUnique({
        where: { id: body.mcpServerId },
        select: { organizationId: true },
      });
      if (!srv || srv.organizationId !== organizationId) {
        throw new NotFoundException('MCP server not found.');
      }
      mcpServerId = body.mcpServerId;
    } else if (body.connectorId) {
      const con = await this.prisma.connector.findUnique({
        where: { id: body.connectorId },
        select: { organizationId: true },
      });
      if (!con || con.organizationId !== organizationId) {
        throw new NotFoundException('Connector not found.');
      }
      connectorId = body.connectorId;
    }
    const status =
      body.status && ['pending', 'applied', 'dismissed'].includes(body.status)
        ? body.status
        : 'applied';
    return this.prisma.kgSkillSuggestion.create({
      data: {
        organizationId,
        connectorId,
        mcpServerId,
        title,
        whenToUse: typeof body.whenToUse === 'string' ? body.whenToUse.slice(0, 1000) : '',
        instruction,
        confidence: 1,
        evidenceCount: 0,
        status,
      },
    });
  }

  private async owned(organizationId: string, id: string) {
    const s = await this.prisma.kgSkillSuggestion.findUnique({ where: { id } });
    if (!s || s.organizationId !== organizationId) throw new NotFoundException('Suggestion not found.');
    return s;
  }

  async apply(organizationId: string, id: string) {
    await this.owned(organizationId, id);
    return this.prisma.kgSkillSuggestion.update({ where: { id }, data: { status: 'applied' } });
  }

  async dismiss(organizationId: string, id: string) {
    await this.owned(organizationId, id);
    return this.prisma.kgSkillSuggestion.update({ where: { id }, data: { status: 'dismissed' } });
  }

  async update(
    organizationId: string,
    id: string,
    patch: { title?: string; whenToUse?: string; instruction?: string; status?: string },
  ) {
    await this.owned(organizationId, id);
    const data: Record<string, unknown> = {};
    if (typeof patch.title === 'string') data.title = patch.title.slice(0, 160);
    if (typeof patch.whenToUse === 'string') data.whenToUse = patch.whenToUse.slice(0, 1000);
    if (typeof patch.instruction === 'string') data.instruction = patch.instruction.slice(0, 2000);
    if (patch.status && ['pending', 'applied', 'dismissed'].includes(patch.status)) {
      data.status = patch.status;
    }
    return this.prisma.kgSkillSuggestion.update({ where: { id }, data });
  }

  async remove(organizationId: string, id: string) {
    await this.owned(organizationId, id);
    await this.prisma.kgSkillSuggestion.delete({ where: { id } });
    return { ok: true };
  }
}
