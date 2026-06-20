/**
 * Apply Koch connector credentials (decrypted on BEKO into /tmp/koch-creds.json)
 * to the local "Koch (BEKO clone)" connectors, re-encrypting authConfig with the
 * LOCAL ENCRYPTION_KEY (BEKO's master key never leaves BEKO).
 *   ENCRYPTION_KEY=... DATABASE_URL=... npx ts-node scripts/koch-apply-creds.ts
 */
import * as fs from 'fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { encrypt } from '../src/common/crypto/encryption.util';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const KEY = process.env.ENCRYPTION_KEY;
  if (!KEY) throw new Error('ENCRYPTION_KEY not set');
  const creds = JSON.parse(fs.readFileSync('/tmp/koch-creds.json', 'utf8'));
  const org = await prisma.organization.findFirst({ where: { name: 'Koch (BEKO clone)' } });
  if (!org) throw new Error('Koch clone org not found — run koch-import first');

  let applied = 0;
  for (const c of creds) {
    if (!c.authConfig) continue;
    const conn = await prisma.connector.findFirst({
      where: { organizationId: org.id, name: c.name },
      select: { id: true },
    });
    if (!conn) continue;
    await prisma.connector.update({
      where: { id: conn.id },
      data: {
        authConfig: encrypt(JSON.stringify(c.authConfig), KEY),
        envVars: c.envVars ?? undefined,
      },
    });
    applied++;
  }
  console.log('applied credentials to', applied, 'connectors');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
