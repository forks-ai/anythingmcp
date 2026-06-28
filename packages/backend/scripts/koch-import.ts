/**
 * Import the Koch connector/server DEFINITIONS exported from BEKO-Cloud into a
 * local "Koch (BEKO clone)" workspace, owned by the existing demo user.
 * Definitions only — no credentials (authConfig/envVars are not set), so tool
 * calls won't execute, but the graph + AI skills work from definitions+intents.
 *   npx ts-node scripts/koch-import.ts /tmp/koch-export.json
 */
import * as fs from 'fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const path = process.argv[2] || '/tmp/koch-export.json';
  const data = JSON.parse(fs.readFileSync(path, 'utf8'));

  const user = await prisma.user.findUnique({ where: { email: 'kg-demo@example.com' } });
  if (!user) throw new Error('demo user kg-demo@example.com not found — run kg-seed first');

  await prisma.organization.deleteMany({ where: { name: 'Koch (BEKO clone)' } });
  const org = await prisma.organization.create({ data: { name: 'Koch (BEKO clone)' } });
  await prisma.organizationMember.create({
    data: { userId: user.id, organizationId: org.id, role: 'ADMIN' },
  });
  // Make it the user's active workspace so login lands here.
  await prisma.user.update({ where: { id: user.id }, data: { organizationId: org.id } });

  // Enable AI features for the clone.
  for (const key of ['kg_llm_enabled', 'kg_capture_intent']) {
    await prisma.orgSettings.create({ data: { organizationId: org.id, key, value: 'true' } });
  }

  const idByName = new Map<string, string>();
  for (const c of data.connectors) {
    const connector = await prisma.connector.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        name: c.name,
        type: c.type,
        baseUrl: c.baseUrl,
        authType: c.authType, // creds intentionally omitted (authConfig null)
        instructions: c.instructions ?? null,
      },
    });
    idByName.set(c.name, connector.id);
    for (const t of c.tools) {
      await prisma.mcpTool.create({
        data: {
          connectorId: connector.id,
          name: t.name,
          description: t.description ?? '',
          parameters: t.parameters ?? {},
          endpointMapping: t.endpointMapping ?? {},
          responseMapping: t.responseMapping ?? undefined,
        },
      });
    }
  }

  for (const s of data.servers) {
    const server = await prisma.mcpServerConfig.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        name: s.name,
        slug: s.slug,
        description: s.description ?? null,
        instructions: s.instructions ?? null,
      },
    });
    for (const name of s.connectorNames) {
      const cid = idByName.get(name);
      if (cid) {
        await prisma.mcpServerConnector.create({
          data: { mcpServerId: server.id, connectorId: cid },
        });
      }
    }
  }

  console.log('Imported into org', org.id, '(Koch (BEKO clone))');
  console.log('  connectors:', data.connectors.length, '| tools:', data.connectors.reduce((n: number, c: any) => n + c.tools.length, 0));
  console.log('  servers:', data.servers.map((s: any) => s.slug).join(', '));
  console.log('  login: kg-demo@example.com / password123 (active org = Koch clone)');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
