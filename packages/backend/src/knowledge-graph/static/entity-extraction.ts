/**
 * Entity-noun extraction from tool names.
 *
 * Grounded in the real catalog naming convention `<slug>_<VERB>_<noun>`
 * (e.g. `pipedrive_list_deals`, `woocommerce_create_product_variation`),
 * with a fallback for the noun-first style some payment APIs use
 * (`adyen_payment_methods`, `adyen_payments_capture`).
 *
 * Returns null for tools that don't map to a domain entity: universal search
 * (`pipedrive_search`), identity probes (`coda_whoami`, `*_get_current_user`),
 * and metadata helpers (`*_list_deal_fields`, `*_list_*_options`).
 */

/** Action verbs that can prefix (or, rarely, suffix) an entity noun. */
const VERBS = new Set([
  'get', 'list', 'create', 'update', 'delete', 'search', 'find', 'add',
  'remove', 'cancel', 'revoke', 'upsert', 'execute', 'fetch', 'send', 'set',
  'archive', 'restore', 'move', 'assign', 'close', 'complete', 'duplicate',
  'retrieve', 'read', 'capture', 'reverse', 'refund', 'authorize',
]);

/** Tokens that decorate a verb but aren't the entity (`batch_update_*`, `list_my_*`). */
const MODIFIERS = new Set(['batch', 'bulk', 'my', 'all']);

/** Verb connectors, e.g. `create_or_update_user`. */
const CONNECTORS = new Set(['or', 'and']);

/**
 * Leading tokens that mark a composite/workflow tool rather than a CRUD op on
 * an entity (e.g. WooCommerce's bundled `*_skill_*` tools). Not domain entities.
 */
const NON_ENTITY_LEADING = new Set(['skill', 'workflow', 'action']);

/**
 * Whole-entity names that are metadata/utility, not domain entities.
 * Compared after normalization (singular last token).
 */
const METADATA_ENTITIES = new Set([
  'me', 'self', 'whoami', 'current_user', 'authorized_user', 'mutation_status',
  'status', 'schema', 'webhook', 'oauth', 'token',
]);

/** Last-token markers that make the whole thing a metadata helper. */
const METADATA_LAST_TOKEN = new Set(['field', 'option', 'schema', 'setting', 'meta']);

export interface ExtractedEntity {
  /** Normalized singular noun, snake_case for compounds. */
  entity: string;
  label: string;
}

/** Very small English singularizer — enough for catalog nouns. */
export function singularize(word: string): string {
  const w = word.toLowerCase();
  if (/ies$/.test(w)) return w.replace(/ies$/, 'y'); // activities -> activity
  if (/(ses|xes|zes|ches|shes)$/.test(w)) return w.replace(/es$/, ''); // addresses -> address
  if (/ss$/.test(w)) return w; // address, business
  if (/[ui]s$/.test(w)) return w; // status, analysis, basis — leave as-is
  if (/s$/.test(w) && w.length > 3) return w.replace(/s$/, ''); // deals -> deal
  return w;
}

function humanize(entity: string): string {
  const s = entity.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Strip the leading slug prefix tokens so what remains starts at the verb/noun. */
function stripSlugTokens(tokens: string[], slug: string): string[] {
  const variants = [slug.replace(/-/g, '_'), slug.replace(/-/g, '')];
  for (const v of variants) {
    const vt = v.split('_').filter(Boolean);
    if (vt.length && vt.every((t, i) => tokens[i] === t)) {
      return tokens.slice(vt.length);
    }
  }
  // Fallback: assume the first token is the (single-token) slug prefix.
  return tokens.length > 1 ? tokens.slice(1) : tokens;
}

function finalizeEntity(tokens: string[]): ExtractedEntity | null {
  if (!tokens.length) return null;
  const lower = tokens.map((t) => t.toLowerCase());
  const last = lower[lower.length - 1];
  if (METADATA_LAST_TOKEN.has(singularize(last))) return null;
  const norm = [...lower.slice(0, -1), singularize(last)];
  const entity = norm.join('_');
  if (METADATA_ENTITIES.has(entity)) return null;
  return { entity, label: humanize(entity) };
}

/**
 * Extract the domain entity a tool operates on, or null if it has none.
 */
export function extractEntity(toolName: string, slug: string): ExtractedEntity | null {
  let toks = toolName.split('_').filter(Boolean);
  toks = stripSlugTokens(toks, slug);
  if (!toks.length) return null;
  if (NON_ENTITY_LEADING.has(toks[0])) return null;

  // Verb-first (the dominant convention): consume leading verbs/modifiers.
  if (VERBS.has(toks[0]) || MODIFIERS.has(toks[0])) {
    let i = 0;
    while (
      i < toks.length &&
      (VERBS.has(toks[i]) || MODIFIERS.has(toks[i]) || CONNECTORS.has(toks[i]))
    ) {
      i++;
    }
    return finalizeEntity(toks.slice(i));
  }

  // Noun-first with trailing verb, e.g. `payments_capture`, `sessions_create`.
  if (toks.length >= 2 && VERBS.has(toks[toks.length - 1])) {
    return finalizeEntity(toks.slice(0, -1));
  }

  // No verb signal at all, e.g. `payment_methods` — best effort.
  return finalizeEntity(toks);
}
