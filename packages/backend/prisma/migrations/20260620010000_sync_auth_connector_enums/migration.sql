-- Sync the AuthType / ConnectorType enums with the connector catalog + DB state.
-- 11 catalog adapters (Pipedrive, Trello, ...) declare authType QUERY_AUTH, which
-- was missing from the enum, so importing them failed with a Prisma validation
-- error. HMAC and WEBHOOK already exist in the database; this only adds the
-- missing QUERY_AUTH value (idempotent).
ALTER TYPE "AuthType" ADD VALUE IF NOT EXISTS 'QUERY_AUTH' AFTER 'API_KEY';
