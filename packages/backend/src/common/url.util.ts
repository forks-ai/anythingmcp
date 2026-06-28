import { BadRequestException } from '@nestjs/common';

// Connector types whose baseUrl is an http(s) endpoint. DATABASE connectors
// carry their own scheme (mysql://, mongodb://, sqlite:, …) and must not be
// rewritten to https.
const HTTP_CONNECTOR_TYPES = new Set(['REST', 'GRAPHQL', 'SOAP', 'MCP']);

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/**
 * Normalize and validate a user-entered connector base URL.
 *
 * - Trims surrounding whitespace.
 * - For HTTP-style connectors (REST/GraphQL/SOAP/MCP) prepends `https://` when
 *   no scheme is present, so `api.example.com` is stored as
 *   `https://api.example.com` instead of silently failing at request time with
 *   a cryptic DNS error (production showed hosts mangled to e.g. `api.https`).
 * - Rejects anything that cannot be parsed as a URL, or whose scheme is not
 *   http/https, with an actionable message — so a malformed base URL is caught
 *   at save time instead of on every tool call.
 *
 * DATABASE (and any non-HTTP) connectors are returned trimmed but otherwise
 * untouched, since their scheme is meaningful and SSRF-checked elsewhere.
 */
export function normalizeConnectorBaseUrl(
  baseUrl: string,
  type?: string,
): string {
  const trimmed = (baseUrl ?? '').trim();
  if (!trimmed) {
    throw new BadRequestException('Base URL is required.');
  }

  // Non-HTTP connectors (DATABASE, etc.) keep their own scheme verbatim.
  if (type && !HTTP_CONNECTOR_TYPES.has(type)) {
    return trimmed;
  }

  const withScheme = SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new BadRequestException(
      `"${baseUrl}" is not a valid URL. Use a full address like ` +
        `https://api.example.com.`,
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException(
      `Base URL must start with http:// or https:// (got "${parsed.protocol}" ` +
        `from "${baseUrl}").`,
    );
  }

  return withScheme;
}
