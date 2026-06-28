import { ConflictException, NotFoundException } from '@nestjs/common';
import { KgSkillService } from './kg-skill.service';

/** Tenant isolation + defaults for manual skill creation. Prisma/LLM mocked. */
describe('KgSkillService.create', () => {
  const ORG = 'org-A';
  const OTHER = 'org-B';

  function make(prisma: any) {
    return new KgSkillService(prisma, {} as any);
  }

  it('rejects an MCP server from another org', async () => {
    const prisma = {
      mcpServerConfig: { findUnique: jest.fn().mockResolvedValue({ organizationId: OTHER }) },
      kgSkillSuggestion: { create: jest.fn() },
    };
    await expect(
      make(prisma).create(ORG, { title: 'T', instruction: 'I', mcpServerId: 'srv' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.kgSkillSuggestion.create).not.toHaveBeenCalled();
  });

  it('rejects a connector from another org', async () => {
    const prisma = {
      connector: { findUnique: jest.fn().mockResolvedValue({ organizationId: OTHER }) },
      kgSkillSuggestion: { create: jest.fn() },
    };
    await expect(
      make(prisma).create(ORG, { title: 'T', instruction: 'I', connectorId: 'c1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires title + instruction', async () => {
    const prisma = { kgSkillSuggestion: { create: jest.fn() } };
    await expect(make(prisma).create(ORG, { title: '', instruction: '' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('creates an applied, server-scoped skill by default', async () => {
    const create = jest.fn().mockResolvedValue({ id: 's1' });
    const prisma = {
      mcpServerConfig: { findUnique: jest.fn().mockResolvedValue({ organizationId: ORG }) },
      kgSkillSuggestion: { create },
    };
    await make(prisma).create(ORG, { title: 'Quote net price', instruction: 'Use get_price', mcpServerId: 'srv' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG,
          mcpServerId: 'srv',
          connectorId: null,
          title: 'Quote net price',
          status: 'applied',
        }),
      }),
    );
  });
});
