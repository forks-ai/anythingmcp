/**
 * Seed a few realistic captured intents on the Koch koch-superpowers server, to
 * demonstrate intent-driven server-level skill generation locally (the real ones
 * come from the user chatting). Usage: npx ts-node scripts/koch-seed-intents.ts
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const server = await prisma.mcpServerConfig.findFirst({
    where: { slug: 'koch-superpowers' },
    select: { id: true, organizationId: true },
  });
  if (!server) throw new Error('koch-superpowers server not found');

  const tool = await prisma.mcpTool.findFirst({
    where: { connector: { organizationId: server.organizationId, name: { contains: 'Orders' } } },
    select: { id: true, connectorId: true, name: true },
  });
  if (!tool) throw new Error('no Orders tool found');

  const intents = [
    'Quanto ha fatturato lo shop oggi? In realtà mi servono gli ordini con status 2, 3 o 4 (trasmesso/aperto/fatturato), non solo lo status 4.',
    'Dammi il fatturato di oggi: per noi il fatturato del giorno include gli ordini trasmessi e aperti (status 2 e 3), non solo i fatturati (status 4).',
    'Mostra le posizioni ordine di oggi includendo status 2,3,4 e riconcilia con lo shop Shopify.',
    'Cerca il cliente per numero e mostrami i suoi ordini aperti e la cronologia vendite.',
  ];
  for (const intent of intents) {
    await prisma.toolInvocation.create({
      data: {
        toolId: tool.id,
        organizationId: server.organizationId,
        connectorId: tool.connectorId,
        mcpServerId: server.id,
        status: 'SUCCESS',
        input: {},
        intent,
        usedProxy: false,
      },
    });
  }
  console.log(`seeded ${intents.length} Koch intents on ${tool.name}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
