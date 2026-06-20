/**
 * Local demo seed for the Knowledge Graph.
 *   npx ts-node scripts/kg-seed.ts
 * Creates an org + verified ADMIN user (kg-demo@example.com / password123),
 * two real connectors (Pipedrive + WooCommerce) with their tools, and a handful
 * of tool_invocations that share identifier values so the observational layer
 * has something to learn (produces_consumes + same_identity).
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import * as bcrypt from 'bcrypt';
import { getAdapter } from '../src/adapters/catalog';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function connectorFromAdapter(
  organizationId: string,
  userId: string,
  slug: string,
  name: string,
) {
  const adapter = getAdapter(slug)!;
  const connector = await prisma.connector.create({
    data: {
      organizationId,
      userId,
      name,
      type: 'REST',
      baseUrl: adapter.connector.baseUrl,
      authType: 'NONE',
    },
  });
  for (const t of adapter.tools) {
    await prisma.mcpTool.create({
      data: {
        connectorId: connector.id,
        name: t.name,
        description: t.description,
        parameters: t.parameters as any,
        endpointMapping: t.endpointMapping as any,
      },
    });
  }
  return connector;
}

async function main() {
  const email = 'kg-demo@example.com';
  await prisma.user.deleteMany({ where: { email } });
  await prisma.organization.deleteMany({ where: { name: 'KG Demo Workspace' } });

  const org = await prisma.organization.create({ data: { name: 'KG Demo Workspace' } });
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash('password123', 10),
      name: 'KG Demo Admin',
      role: 'ADMIN',
      emailVerified: true,
      organizationId: org.id,
    },
  });
  await prisma.organizationMember.create({
    data: { userId: user.id, organizationId: org.id, role: 'ADMIN' },
  });

  const pipedrive = await connectorFromAdapter(org.id, user.id, 'pipedrive', 'Pipedrive');
  const woo = await connectorFromAdapter(org.id, user.id, 'woocommerce', 'WooCommerce');

  // Tool id lookup helper.
  const toolId = async (connectorId: string, name: string) =>
    (await prisma.mcpTool.findFirst({ where: { connectorId, name }, select: { id: true } }))?.id;

  const log = async (
    connectorId: string,
    toolName: string,
    input: any,
    output: any,
  ) => {
    const tId = await toolId(connectorId, toolName);
    if (!tId) {
      console.warn(`  ! tool not found: ${toolName}`);
      return;
    }
    await prisma.toolInvocation.create({
      data: {
        toolId: tId,
        organizationId: org.id,
        connectorId,
        status: 'SUCCESS',
        input,
        output,
        usedProxy: false,
      },
    });
  };

  // Shared identifiers across calls.
  const personId = 99001;
  const email1 = 'jane.doe@acme-corp.com';

  // Pipedrive: create person (produces id 99001 + email), then a deal consuming person_id.
  await log('' + pipedrive.id, 'pipedrive_create_person', { name: 'Jane Doe', email: email1 }, { id: personId, name: 'Jane Doe', email: email1 });
  await log('' + pipedrive.id, 'pipedrive_list_persons', { limit: 50 }, { items: [{ id: personId, email: email1 }] });
  await log('' + pipedrive.id, 'pipedrive_create_deal', { title: 'New deal', person_id: personId, value: 5000 }, { id: 70011, person_id: personId });
  await log('' + pipedrive.id, 'pipedrive_get_deal', { id: 70011 }, { id: 70011, person_id: personId, title: 'New deal' });

  // WooCommerce: same customer email appears here -> same_identity (person ~ customer).
  await log('' + woo.id, 'woocommerce_create_customer', { email: email1, first_name: 'Jane' }, { id: 55012, email: email1 });
  await log('' + woo.id, 'woocommerce_list_orders', { customer: '55012' }, { items: [{ id: 88003, customer_id: 55012 }] });

  console.log('Seed complete:');
  console.log('  org:', org.id);
  console.log('  user:', email, '/ password123 (ADMIN)');
  console.log('  connectors:', pipedrive.id, '(pipedrive),', woo.id, '(woocommerce)');
  console.log('  invocations: 6');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
