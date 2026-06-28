# Row-Level Security (defense-in-depth tenant isolation)

AnythingMCP isolates tenants at the **application layer** today: every org-scoped
query carries an explicit `where: { organizationId }`, and the MCP endpoints are
fail-closed per server (see the tenant-isolation guard). **Row-Level Security
(RLS)** adds a second, database-enforced layer so a missing `where` clause or a
SQL mistake can't leak another tenant's rows.

> **Status: foundation shipped, OFF by default.** The `tenantTx` execution path
> and the enable/disable SQL exist and are proven by a real-DB test, but RLS is
> **not** enabled automatically. Turning it on is a deliberate rollout (below) —
> enabling it before the query call sites are migrated will break the app.

## How it works

- **Policy.** Each org-scoped table gets `org_isolation`:
  `organization_id = current_setting('app.current_org', true)`, both `USING`
  (reads) and `WITH CHECK` (writes). With no context set the setting is `NULL`,
  so the table is **fail-closed** — zero rows, writes rejected.
- **Context.** The app sets the tenant per request via
  `PrismaService.tenantTx(orgId, tx => …)`, which runs the work inside a
  transaction after `set_config('app.current_org', orgId, true)`. The `true`
  makes it **transaction-local**, so it can't leak across requests sharing a
  pooled connection.

## ⚠️ The application role must NOT be a superuser

RLS — even `FORCE ROW LEVEL SECURITY` — is **bypassed for `SUPERUSER` and
`BYPASSRLS` roles**. The default Docker Postgres role (`amcp`) is a superuser, so
with that role RLS has no effect. Before enabling RLS, create a dedicated,
unprivileged application role and point `DATABASE_URL` at it:

```sql
CREATE ROLE amcp_app LOGIN PASSWORD '...';      -- NOT superuser, NOT BYPASSRLS
GRANT CONNECT ON DATABASE anythingmcp TO amcp_app;
GRANT USAGE ON SCHEMA public TO amcp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO amcp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO amcp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO amcp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO amcp_app;
```

Keep a separate superuser/`BYPASSRLS` role for migrations and cross-tenant
maintenance/cron jobs.

## Rollout (staged)

1. **Create the unprivileged app role** and switch `DATABASE_URL` to it.
2. **Migrate org-scoped query call sites** to run through `tenantTx(orgId, …)`.
   Cross-org paths (login-by-email before the org is known, admin listings, the
   discovery cron) must run under the maintenance role or set the context
   per-org explicitly — they will otherwise see nothing once RLS is on.
3. **Apply the policies**: `psql "$DATABASE_URL" -f packages/backend/prisma/rls/enable-rls.sql`.
4. **Verify** with the real-DB test:
   `RLS_TEST_DATABASE_URL="$DATABASE_URL" npx jest rls.integration`
   (creates its own throwaway table + role; never touches app tables).
5. Flip `ENABLE_RLS=true` so the app routes through `tenantTx`.

Rollback at any time with `prisma/rls/disable-rls.sql`.

## Files

- `packages/backend/prisma/rls/enable-rls.sql` — enable + policies (idempotent)
- `packages/backend/prisma/rls/disable-rls.sql` — rollback (idempotent)
- `PrismaService.tenantTx()` — the per-request tenant-context transaction
- `src/common/rls.integration.spec.ts` — real-Postgres isolation proof (gated by
  `RLS_TEST_DATABASE_URL`)
