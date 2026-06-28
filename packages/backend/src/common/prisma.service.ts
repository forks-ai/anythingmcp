import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Run `fn` inside a transaction that has the tenant context set, so Postgres
   * Row-Level Security policies (`organization_id = current_setting('app.current_org')`)
   * scope every statement to this org. `set_config(..., true)` is **transaction-local**,
   * so it cannot leak to another request sharing the pooled connection.
   *
   * This is the execution path RLS depends on (defense-in-depth on top of the
   * app-layer `where: { organizationId }`). It is inert until RLS is actually
   * enabled on the tables (see `prisma/rls/enable-rls.sql`, gated by ENABLE_RLS):
   * with RLS off the SET is simply ignored.
   */
  async tenantTx<T>(
    organizationId: string,
    fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>,
  ): Promise<T> {
    if (!organizationId) {
      throw new Error('tenantTx requires a non-empty organizationId');
    }
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_org', ${organizationId}, true)`;
      return fn(tx);
    });
  }
}
