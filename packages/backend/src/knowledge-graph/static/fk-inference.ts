/**
 * Foreign-key-style edge inference from parameter names.
 *
 * Real catalog data uses three FK conventions, all handled here:
 *   - snake   `person_id`, `org_id`, `stage_id`   (Pipedrive, Zendesk, WooCommerce)
 *   - camel   `customerId`, `mandateId`, `listId`  (Mollie, ClickUp, Coda)
 *   - prefix  `idList`, `idBoard`, `idLabels`      (Trello)
 *   - suffix  `shopperReference`, `…_reference`     (Adyen)
 *
 * A generic-field stoplist prevents over-connecting on `id`, `name`, `email`,
 * `status`, … which appear on nearly every entity and carry no link meaning.
 */

import { singularize } from './entity-extraction';

/** Field nouns too generic to be a join key — never produce an edge. */
// Generic field nouns that are never a join key. NOTE: words that double as
// real domain entities (order, group, account, ...) are deliberately NOT here —
// `order_id`/`group_id` are legitimate FKs. Only truly non-entity tokens belong.
const GENERIC = new Set([
  'id', 'name', 'email', 'status', 'type', 'description', 'url', 'page',
  'limit', 'cursor', 'query', 'offset', 'sort', 'search', 'term',
  'filter', 'date', 'time', 'created', 'updated', 'count', 'total', 'data',
  'value', 'title', 'body', 'text', 'message', 'note', 'label', 'tag',
  'color', 'locale', 'currency', 'amount', 'price', 'quantity', 'key',
  'token', 'code', 'parent', 'external', 'reference',
]);

/** Map a referenced noun to its canonical entity name when they differ. */
const ALIASES: Record<string, string> = {
  org: 'organization',
};

/**
 * Given a parameter name, return the canonical entity noun it references,
 * or null if it is not an FK-style field.
 */
export function fkCandidate(field: string): string | null {
  let noun: string | null = null;

  if (/^id[A-Z]/.test(field)) {
    noun = field.slice(2); // idList -> List
  } else if (/_id$/.test(field)) {
    noun = field.slice(0, -3); // person_id -> person
  } else if (/Id$/.test(field) && field.length > 2) {
    noun = field.slice(0, -2); // customerId -> customer
  } else if (/_reference$/i.test(field)) {
    noun = field.replace(/_reference$/i, '');
  } else if (/[a-z]Reference$/.test(field)) {
    noun = field.replace(/Reference$/, ''); // shopperReference -> shopper
  } else {
    return null;
  }

  noun = singularize(noun.replace(/_/g, '').toLowerCase());
  if (!noun || GENERIC.has(noun)) return null;
  return ALIASES[noun] ?? noun;
}

/**
 * Mine FK-style tokens out of free text (a tool description), e.g. a sentence
 * "Returns the deal id, ..., owner_id, person_id, org_id" yields person/org.
 * Returns the set of canonical entity nouns referenced.
 */
export function fkCandidatesFromText(text: string): string[] {
  if (!text) return [];
  const tokens = text.match(/[A-Za-z]+_id\b|\bid[A-Z][A-Za-z]+|\b[a-z]+Id\b/g) ?? [];
  const out = new Set<string>();
  for (const t of tokens) {
    const c = fkCandidate(t);
    if (c) out.add(c);
  }
  return [...out];
}
