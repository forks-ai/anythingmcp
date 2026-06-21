import { KgCronService } from './kg-cron.service';
import * as llm from '../../knowledge-graph/llm-client';

jest.mock('../../knowledge-graph/llm-client', () => ({
  resolveLlmConfig: jest.fn(),
  submitBatch: jest.fn(),
  getBatchResults: jest.fn(),
}));

/** Batch-mode (Anthropic) cron: deferred submit→apply, one batch at a time. */
describe('KgCronService — batch mode', () => {
  const callExtend = (svc: KgCronService) => (svc as any).runLlmExtend();

  beforeEach(() => {
    process.env.KG_LLM_CRON_ENABLED = 'true';
    process.env.KG_LLM_BATCH = 'true';
    (llm.resolveLlmConfig as jest.Mock).mockReturnValue({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      apiKey: 'k',
    });
  });
  afterEach(() => {
    delete process.env.KG_LLM_CRON_ENABLED;
    delete process.env.KG_LLM_BATCH;
    jest.clearAllMocks();
  });

  it('SUBMIT: builds enrich+skill requests, submits one batch, stamps cooldown', async () => {
    const prisma = {
      kgLlmBatch: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      orgSettings: {
        findMany: jest.fn().mockResolvedValue([{ organizationId: 'org-A' }]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      // getLastRun reads orgSettings.findUnique
    } as any;
    prisma.orgSettings.findUnique = jest.fn().mockResolvedValue(null);
    prisma.toolInvocation = { count: jest.fn().mockResolvedValue(3) };

    const kgLlm = {
      isEnabled: jest.fn().mockResolvedValue(true),
      buildEnrichRequest: jest
        .fn()
        .mockResolvedValue({ system: 'S', user: 'U', idByRef: { e0: 'n1' }, hash: 'h' }),
    };
    const kgSkill = {
      buildConnectorRequest: jest.fn().mockResolvedValue({ system: 'CS', user: 'CU' }),
    };
    (llm.submitBatch as jest.Mock).mockResolvedValue('batch_123');

    const svc = new KgCronService(prisma, {} as any, {} as any, kgLlm as any, kgSkill as any);
    const r = await callExtend(svc);

    expect(llm.submitBatch).toHaveBeenCalledTimes(1);
    const reqs = (llm.submitBatch as jest.Mock).mock.calls[0][1];
    expect(reqs.map((x: any) => x.customId).sort()).toEqual(['enrich:org-A', 'skill:org-A']);
    expect(prisma.kgLlmBatch.create).toHaveBeenCalled();
    expect(prisma.orgSettings.upsert).toHaveBeenCalled(); // cooldown stamped
    expect(r.llmBatchSubmitted).toBe(2);
  });

  it('APPLY: applies a completed batch, deletes it, does not submit a new one', async () => {
    const context = {
      'enrich:org-A': { type: 'enrich', organizationId: 'org-A', idByRef: { e0: 'n1' }, hash: 'h' },
      'skill:org-A': { type: 'skill', organizationId: 'org-A' },
    };
    const prisma = {
      kgLlmBatch: {
        findFirst: jest.fn().mockResolvedValue({ id: 'b1', externalId: 'batch_123', context }),
        delete: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const kgLlm = { applyEnrichResult: jest.fn().mockResolvedValue(4) };
    const kgSkill = { applyConnectorResult: jest.fn().mockResolvedValue(2) };
    (llm.getBatchResults as jest.Mock).mockResolvedValue({
      done: true,
      results: [
        { customId: 'enrich:org-A', json: { relationships: [] } },
        { customId: 'skill:org-A', json: { skills: [] } },
      ],
    });

    const svc = new KgCronService(prisma, {} as any, {} as any, kgLlm as any, kgSkill as any);
    const r = await callExtend(svc);

    expect(kgLlm.applyEnrichResult).toHaveBeenCalledWith(
      'org-A',
      { relationships: [] },
      { idByRef: { e0: 'n1' }, hash: 'h' },
    );
    expect(kgSkill.applyConnectorResult).toHaveBeenCalledWith('org-A', { skills: [] });
    expect(prisma.kgLlmBatch.delete).toHaveBeenCalledWith({ where: { id: 'b1' } });
    expect(llm.submitBatch).not.toHaveBeenCalled();
    expect(r).toMatchObject({ llmOrgs: 1, llmGraphSuggested: 4, llmSkillsCreated: 2, llmBatchSubmitted: 0 });
  });

  it('APPLY: a still-running batch is left alone (no apply, no submit)', async () => {
    const prisma = {
      kgLlmBatch: {
        findFirst: jest.fn().mockResolvedValue({ id: 'b1', externalId: 'x', context: {} }),
        delete: jest.fn(),
      },
    } as any;
    (llm.getBatchResults as jest.Mock).mockResolvedValue({ done: false, results: [] });

    const svc = new KgCronService(prisma, {} as any, {} as any, {} as any, {} as any);
    const r = await callExtend(svc);

    expect(prisma.kgLlmBatch.delete).not.toHaveBeenCalled();
    expect(llm.submitBatch).not.toHaveBeenCalled();
    expect(r.llmBatchSubmitted).toBe(0);
  });
});
