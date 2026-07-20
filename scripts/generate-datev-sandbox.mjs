#!/usr/bin/env node
/**
 * Derives the DATEV **Sandbox** adapter from the production DATEV adapter so the
 * two never drift: the 6 tool definitions are the single source of truth in
 * `de/datev.json`; only the environment-specific URLs/paths differ.
 *
 * Sandbox vs production (per DATEV's OIDC discovery):
 *   authorize : login.datev.de/openid/authorize       -> login.datev.de/openidsandbox/authorize
 *   token     : api.datev.de/token                    -> sandbox-api.datev.de/token
 *   API base  : *.api.datev.de/platform/v2            -> *.api.datev.de/platform-sandbox/v2
 *
 * Run after editing de/datev.json:  node scripts/generate-datev-sandbox.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const adaptersDir = join(here, '..', 'packages', 'backend', 'src', 'adapters', 'de');
const prod = JSON.parse(readFileSync(join(adaptersDir, 'datev.json'), 'utf-8'));

const toSandbox = (s) =>
  s
    .replace('login.datev.de/openid/authorize', 'login.datev.de/openidsandbox/authorize')
    .replace('https://api.datev.de/token', 'https://sandbox-api.datev.de/token')
    .replace(/\/platform\/v2\//g, '/platform-sandbox/v2/')
    .replace(/\/platform\/v2$/g, '/platform-sandbox/v2');

const sandbox = JSON.parse(JSON.stringify(prod));
sandbox.slug = 'datev-sandbox';
sandbox.name = 'DATEV Online APIs (Sandbox)';
sandbox.description =
  'Sandbox environment for the DATEV Online APIs — read accounting Mandanten (clients), document types and DUO version metadata against DATEV\'s test data. Use this while you build and test; every new DATEV app must run in sandbox until DATEV grants production approval. Same OAuth2 Authorization Code + PKCE flow as production, pointed at DATEV\'s sandbox endpoints.';
sandbox.instructions =
  '**Use this connector for testing.** Every DATEV app runs in the sandbox until DATEV completes its production-approval review — so this is where you start.\n\n' +
  '**Setup**:\n' +
  '1. Create a **Confidential** app on the DATEV-Entwicklerportal (https://developer.datev.de) with **OpenID Connect Authorization Code Flow**. Set the redirect URI to `<your-server>/api/mcp-oauth/callback`.\n' +
  '2. Subscribe the app to the sandbox API products: **accounting:clients 2.0** and **accounting:documents 2.0**.\n' +
  '3. Set `DATEV_CLIENT_ID` and `DATEV_CLIENT_SECRET` (from the portal — copy the secret in full, it is shown only once).\n' +
  '4. Import this adapter — it is pre-configured for the sandbox (authorize `login.datev.de/openidsandbox/authorize`, token `sandbox-api.datev.de/token`, API base `platform-sandbox/v2`) and authenticates at the token endpoint via **HTTP Basic** (`client_secret_basic`), which DATEV requires.\n' +
  '5. Run the one-time OAuth flow: `POST /api/connectors/{id}/oauth/authorize` -> open the returned URL -> log in with your DATEV-Konto -> the platform stores an encrypted refresh token automatically.\n' +
  '6. Every call then sends `Authorization: Bearer <token>` AND the mandatory `X-DATEV-Client-Id: <DATEV_CLIENT_ID>` header automatically.\n\n' +
  '**Going to production**: once DATEV approves your app for production, use the separate **DATEV Online APIs** connector (same credentials, production endpoints).\n\n' +
  '**Scopes requested**: `datev:accounting:clients accounting:clients:read accounting:documents`. Do NOT add `openid` — it is the issuer name, not a requested scope.\n\n' +
  '**Mandant scoping**: every per-client tool takes a `clientId` parameter — the **Mandant UUID** (RFC4122), returned by `datev_list_clients`. Distinct from `DATEV_CLIENT_ID` (the OAuth app identifier, sent in the header).';

sandbox.connector.name = 'DATEV Online APIs (Sandbox)';
sandbox.connector.baseUrl = toSandbox(prod.connector.baseUrl);
sandbox.connector.authConfig.authorizationUrl = toSandbox(prod.connector.authConfig.authorizationUrl);
sandbox.connector.authConfig.tokenUrl = toSandbox(prod.connector.authConfig.tokenUrl);
// tokenAuthMethod ('basic') and scopes carry over unchanged from prod.
sandbox.tools = prod.tools.map((t) => ({
  ...t,
  endpointMapping: { ...t.endpointMapping, path: toSandbox(t.endpointMapping.path) },
}));

writeFileSync(
  join(adaptersDir, 'datev-sandbox.json'),
  JSON.stringify(sandbox, null, 2) + '\n',
  'utf-8',
);
console.log('Generated de/datev-sandbox.json from de/datev.json');
console.log('  baseUrl   :', sandbox.connector.baseUrl);
console.log('  authorize :', sandbox.connector.authConfig.authorizationUrl);
console.log('  token     :', sandbox.connector.authConfig.tokenUrl);
console.log('  tools     :', sandbox.tools.length, '(paths -> platform-sandbox)');
