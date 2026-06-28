import { Pool, PoolClient } from 'pg';

/**
 * Real-Postgres proof that the RLS pattern shipped in prisma/rls/enable-rls.sql
 * + PrismaService.tenantTx() actually isolates tenants. The unit suite mocks
 * Prisma and cannot exercise row-level security, so this runs against a live DB.
 *
 * Gated: set RLS_TEST_DATABASE_URL to run it (CI/local with a throwaway DB).
 * It only ever touches its own scratch table + role — never the app tables.
 *
 * IMPORTANT (operational): RLS is bypassed for SUPERUSER / BYPASSRLS roles even
 * with FORCE. Production must connect as a plain (non-superuser) role for the
 * policy to take effect — the test reproduces that by running queries under a
 * restricted role via `SET LOCAL ROLE`.
 */
const DB_URL = process.env.RLS_TEST_DATABASE_URL;
const TABLE = '_rls_isolation_test';
const ROLE = 'rls_test_app';
const d = DB_URL ? describe : describe.skip;

d('RLS tenant isolation (real Postgres)', () => {
  let pool: Pool;

  /** App-role transaction (subject to RLS), optionally with a tenant context. */
  async function asApp<T>(org: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${ROLE}`);
      if (org) await client.query("SELECT set_config('app.current_org', $1, true)", [org]);
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL });
    await pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await pool.query(`DROP ROLE IF EXISTS ${ROLE}`);
    await pool.query(`CREATE ROLE ${ROLE} NOLOGIN`);
    await pool.query(`CREATE TABLE ${TABLE} (id serial PRIMARY KEY, organization_id text NOT NULL, val text)`);
    await pool.query(`GRANT SELECT, INSERT ON ${TABLE} TO ${ROLE}`);
    await pool.query(`GRANT USAGE, SELECT ON SEQUENCE ${TABLE}_id_seq TO ${ROLE}`);
    await pool.query(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY`);
    await pool.query(`ALTER TABLE ${TABLE} FORCE ROW LEVEL SECURITY`);
    await pool.query(
      `CREATE POLICY org_isolation ON ${TABLE} ` +
        `USING (organization_id = current_setting('app.current_org', true)) ` +
        `WITH CHECK (organization_id = current_setting('app.current_org', true))`,
    );
    // Seed as the (superuser) owner — bypasses RLS, so no context needed.
    await pool.query(`INSERT INTO ${TABLE}(organization_id,val) VALUES ('org-A','a1'),('org-A','a2'),('org-B','b1')`);
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await pool.query(`DROP ROLE IF EXISTS ${ROLE}`);
    await pool.end();
  });

  it('a tenant sees only its own rows', async () => {
    const a = await asApp('org-A', (c) => c.query(`SELECT val FROM ${TABLE} ORDER BY val`));
    expect(a.rows.map((r) => r.val)).toEqual(['a1', 'a2']);
    const b = await asApp('org-B', (c) => c.query(`SELECT val FROM ${TABLE} ORDER BY val`));
    expect(b.rows.map((r) => r.val)).toEqual(['b1']);
  });

  it('fails closed: no tenant context → no rows', async () => {
    const r = await asApp(null, (c) => c.query(`SELECT count(*)::int AS n FROM ${TABLE}`));
    expect(r.rows[0].n).toBe(0);
  });

  it('blocks writing another tenant’s row (WITH CHECK)', async () => {
    await expect(
      asApp('org-A', (c) => c.query(`INSERT INTO ${TABLE}(organization_id,val) VALUES ('org-B','hijack')`)),
    ).rejects.toThrow();
  });

  it('context is transaction-local — it does not leak to the next query', async () => {
    await asApp('org-A', (c) => c.query(`SELECT 1`));
    const r = await asApp(null, (c) => c.query(`SELECT count(*)::int AS n FROM ${TABLE}`));
    expect(r.rows[0].n).toBe(0);
  });
});
