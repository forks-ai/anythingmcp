/**
 * Backfill tool outputSchema from observed responses: for each tool without a
 * schema, infer one from its most recent SUCCESS tool_invocation output.
 *   npx ts-node scripts/infer-output-schemas.ts [organizationName]
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { inferJsonSchema } from '../src/connectors/output-schema.util';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const orgName = process.argv[2];
  const orgFilter = orgName
    ? { connector: { organization: { name: orgName } } }
    : {};

  // Json-null filters are quirky in Prisma; filter for "no schema" in JS.
  const all = await prisma.mcpTool.findMany({
    where: orgFilter,
    select: { id: true, name: true, outputSchema: true },
  });
  const tools = all.filter((t) => t.outputSchema == null);

  let filled = 0;
  for (const t of tools) {
    const inv = await prisma.toolInvocation.findFirst({
      where: { toolId: t.id, status: 'SUCCESS' },
      select: { output: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!inv?.output) continue;
    const schema = inferJsonSchema(inv.output);
    if (!schema) continue;
    await prisma.mcpTool.update({ where: { id: t.id }, data: { outputSchema: schema as any } });
    filled++;
  }
  console.log(`inferred outputSchema for ${filled}/${tools.length} schema-less tools`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
