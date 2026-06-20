import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { KgLlmService } from './kg-llm.service';
import { chatJson, resolveLlmConfig } from './llm-client';

const MAX_INTENTS = 200;

const SYSTEM_PROMPT = `You improve an AI tool-integration platform by turning real user requests ("intents") into reusable "skills" — short corrections or domain rules that make future tool calls behave the way the user actually wants.

You receive recent tool calls, each with: the user's intent (their natural-language request), the tool name, its connector, and whether it succeeded.

Find RECURRING or HIGH-VALUE patterns where a rule would help. Example: users asking for "daily revenue" really want orders with status 2, 3 AND 4 (transmitted/open/invoiced), not only status 4 (invoiced).

Return STRICT JSON: {"skills":[{"title":"<short>","connector":"<connector name or null>","whenToUse":"<when this rule applies>","instruction":"<imperative guidance for the agent>","confidence":0..1,"evidenceCount":<int>}]}.

Rules:
- Propose at most 6 skills. Prefer specific, actionable rules over vague ones.
- "instruction" must be concrete guidance an agent can follow.
- Only use connector names that appear in the input (or null).
- If there is no useful pattern, return {"skills":[]}.`;

/**
 * Turns captured user intents (tool_invocations.intent) into reviewable skill
 * suggestions via the LLM. Opt-in (requires AI enrichment enabled). Each
 * suggestion is reviewed by an admin; applying one appends its instruction to
 * the connector's guidance, which the MCP server composes into its instructions.
 */
@Injectable()
export class KgSkillService {
  private readonly logger = new Logger(KgSkillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: KgLlmService,
  ) {}

  async generate(organizationId: string): Promise<{ created: number; model?: string; usage?: any }> {
    if (!(await this.llm.isEnabled(organizationId))) {
      throw new ConflictException('AI features are disabled for this workspace.');
    }
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
      intent: (i.intent ?? '').slice(0, 400),
      tool: i.tool?.name ?? 'unknown',
      connector: i.tool?.connector?.name ?? '',
      ok: i.status === 'SUCCESS',
    }));

    const { json, usage } = await chatJson(cfg, SYSTEM_PROMPT, JSON.stringify({ calls }), 1500);
    const skills: any[] = Array.isArray(json?.skills) ? json.skills : [];

    // Map connector name -> id for this org.
    const connectors = await this.prisma.connector.findMany({
      where: { organizationId },
      select: { id: true, name: true },
    });
    const idByName = new Map(connectors.map((c) => [c.name.toLowerCase(), c.id]));

    // Replace previous still-pending suggestions; keep applied/dismissed history.
    await this.prisma.kgSkillSuggestion.deleteMany({
      where: { organizationId, status: 'pending' },
    });

    let created = 0;
    for (const s of skills) {
      const title = typeof s?.title === 'string' ? s.title.slice(0, 160) : null;
      const instruction = typeof s?.instruction === 'string' ? s.instruction.slice(0, 2000) : null;
      if (!title || !instruction) continue;
      await this.prisma.kgSkillSuggestion.create({
        data: {
          organizationId,
          connectorId:
            typeof s?.connector === 'string' ? (idByName.get(s.connector.toLowerCase()) ?? null) : null,
          title,
          whenToUse: typeof s?.whenToUse === 'string' ? s.whenToUse.slice(0, 1000) : '',
          instruction,
          confidence: Math.max(0, Math.min(1, Number(s?.confidence) || 0.5)),
          evidenceCount: Math.max(0, Math.min(9999, parseInt(s?.evidenceCount, 10) || 0)),
        },
      });
      created++;
    }

    this.logger.log(
      `KG skills ${organizationId}: ${created} from ${invocations.length} intents (${cfg.model}, in=${usage?.inputTokens ?? '?'} out=${usage?.outputTokens ?? '?'})`,
    );
    return { created, model: cfg.model, usage };
  }

  async list(organizationId: string) {
    return this.prisma.kgSkillSuggestion.findMany({
      where: { organizationId },
      orderBy: [{ status: 'asc' }, { confidence: 'desc' }],
      include: { connector: { select: { name: true } } },
    });
  }

  /** Apply a suggestion: append its instruction to the connector's guidance. */
  async apply(organizationId: string, id: string) {
    const s = await this.prisma.kgSkillSuggestion.findUnique({ where: { id } });
    if (!s || s.organizationId !== organizationId) throw new NotFoundException('Suggestion not found.');

    if (s.connectorId) {
      const connector = await this.prisma.connector.findUnique({
        where: { id: s.connectorId },
        select: { id: true, instructions: true, organizationId: true },
      });
      if (connector && connector.organizationId === organizationId) {
        const addition = `\n\n[Skill] ${s.title} — When: ${s.whenToUse}\n${s.instruction}`;
        if (!(connector.instructions ?? '').includes(addition.trim())) {
          await this.prisma.connector.update({
            where: { id: connector.id },
            data: { instructions: (connector.instructions ?? '') + addition },
          });
        }
      }
    }

    return this.prisma.kgSkillSuggestion.update({ where: { id }, data: { status: 'applied' } });
  }

  async dismiss(organizationId: string, id: string) {
    const s = await this.prisma.kgSkillSuggestion.findUnique({
      where: { id },
      select: { organizationId: true },
    });
    if (!s || s.organizationId !== organizationId) throw new NotFoundException('Suggestion not found.');
    return this.prisma.kgSkillSuggestion.update({ where: { id }, data: { status: 'dismissed' } });
  }
}
