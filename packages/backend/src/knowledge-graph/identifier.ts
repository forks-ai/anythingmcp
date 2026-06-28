/**
 * Identifier extraction + PII-safe hashing for the observational KG layer.
 *
 * We never store raw values. To correlate "this value produced by tool A is the
 * same value consumed by tool B" we store only an HMAC of the value, keyed by a
 * per-organization secret so hashes are not comparable across tenants.
 *
 * Only "identifier-like" leaf values are considered — long ids, UUIDs, emails —
 * never free text, booleans, or short enums (which would collide and over-link).
 */

import { createHmac } from 'crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Field names whose values are noise for identity correlation. */
const FIELD_STOPLIST = new Set([
  'created', 'updated', 'created_at', 'updated_at', 'createdat', 'updatedat',
  'date', 'time', 'timestamp', 'url', 'uri', 'href', 'link', 'avatar', 'image',
  'description', 'body', 'text', 'note', 'content', 'message', 'token', 'secret',
  'password', 'signature', 'hash', 'color', 'locale', 'currency', 'status',
  'type', 'kind', 'page', 'cursor', 'limit', 'offset',
  // Numeric values that aren't identities (avoid linking on a shared amount).
  'value', 'amount', 'price', 'total', 'quantity', 'count', 'score', 'rating',
  'duration', 'size', 'weight', 'age', 'year',
]);

export function isIdentifierLike(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isInteger(value) && Math.abs(value) >= 1000;
  }
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (s.length < 6 || s.length > 200) return false;
  if (EMAIL_RE.test(s)) return true;
  if (UUID_RE.test(s)) return true;
  if (/\s/.test(s)) return false; // multi-word → not an identifier
  if (/^\d{6,}$/.test(s)) return true; // long numeric id
  if (/^[A-Za-z0-9_\-:.]+$/.test(s) && /\d/.test(s)) return true; // alnum id with a digit
  return false;
}

export interface IdentifierOccurrence {
  field: string;
  value: string;
}

/** Max JSON nodes to walk per payload (bounds CPU on huge bulk responses). */
const MAX_WALK_NODES = 5000;

/**
 * Walk an arbitrary JSON value and yield (leaf-field, identifier-value) pairs.
 * Uses the leaf key as the field name (FK fields are leaf keys like customer_id).
 */
export function extractIdentifiers(input: unknown): IdentifierOccurrence[] {
  const out: IdentifierOccurrence[] = [];
  const seen = new Set<string>();
  // Bound work on pathologically large payloads (e.g. a bulk DB dump): a few
  // thousand nodes is plenty to capture representative identifiers, and stops a
  // single huge response from pinning the event loop.
  let visited = 0;

  const walk = (node: unknown, key: string | null): void => {
    if (visited++ > MAX_WALK_NODES) return;
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, key);
      return;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, k);
      }
      return;
    }
    if (!key) return;
    const field = key.toLowerCase();
    if (FIELD_STOPLIST.has(field)) return;
    if (!isIdentifierLike(node)) return;
    const valueStr = String(node);
    const dedupeKey = `${field}=${valueStr}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    out.push({ field, value: valueStr });
  };

  walk(input, null);
  return out;
}

/**
 * Collect all leaf field NAMES from a JSON payload (deduped, lowercased).
 * Used to mine FK-style relationships from a tool's response shape even when
 * no value coincidence is observed (e.g. a get_order response carrying a
 * `customer_id` field implies Order -> Customer).
 */
export function extractFieldNames(input: unknown): string[] {
  const out = new Set<string>();
  let visited = 0;
  const walk = (node: unknown): void => {
    if (visited++ > MAX_WALK_NODES) return;
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out.add(k.toLowerCase());
        walk(v);
      }
    }
  };
  walk(input);
  return [...out];
}

/** Stable per-organization key derived from a server secret. */
function orgKey(orgId: string): Buffer {
  const secret =
    process.env.KG_HASH_SECRET ||
    process.env.ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    'anythingmcp-kg-dev-secret';
  return createHmac('sha256', secret).update(orgId).digest();
}

/** HMAC of an identifier value, scoped to the organization. Hex, truncated. */
export function hashValue(orgId: string, value: string): string {
  return createHmac('sha256', orgKey(orgId)).update(value).digest('hex').slice(0, 40);
}
