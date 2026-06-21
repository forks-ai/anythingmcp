/**
 * Conservative PII redaction for captured user intents before they are sent to
 * the LLM (skill generation). Skill inference needs the *pattern* of a request
 * ("revenue for ecommerce", "create order for customer X"), not the concrete
 * identifiers — so scrubbing emails/phones/ids/cards keeps quality while
 * minimizing personal-data exposure to the AI sub-processor (GDPR).
 *
 * Toggle with KG_LLM_REDACT_INTENTS (default on). Locale-generic by design.
 */

const PATTERNS: Array<[RegExp, string]> = [
  // emails
  [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[email]'],
  // IBAN (2 country letters + 2 check digits + 11–30 alphanumerics)
  [/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, '[iban]'],
  // credit-card-like: 13–19 digits, optionally separated by spaces/dashes
  [/\b(?:\d[ -]?){13,19}\b/g, '[card]'],
  // phone numbers: optional +, then 7–15 digits with spaces/dashes/parens
  [/\+?\d[\d ().-]{6,}\d/g, '[phone]'],
  // any remaining run of 5+ digits (ids, order numbers, postal codes, …)
  [/\b\d{5,}\b/g, '[number]'],
];

export function redactPii(text: string): string {
  if (!text) return text;
  let out = text;
  for (const [re, repl] of PATTERNS) out = out.replace(re, repl);
  return out;
}

/** Whether intent redaction is enabled (default true). */
export function redactionEnabled(): boolean {
  return process.env.KG_LLM_REDACT_INTENTS !== 'false';
}

/** Redact an intent only when redaction is enabled. */
export function maybeRedactIntent(intent: string): string {
  return redactionEnabled() ? redactPii(intent) : intent;
}
