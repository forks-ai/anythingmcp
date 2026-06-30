import { Controller, Get, Param, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Serves OAuth/OIDC discovery documents that some MCP clients require but
 * @rekog/mcp-nest does not expose at these paths:
 *   - GET /.well-known/openid-configuration                          (+ per-server)
 *   - GET /.well-known/oauth-authorization-server/mcp/:serverId      (per-server)
 *   - GET /.well-known/oauth-protected-resource/mcp/:serverId        (per-server)
 *
 * Background: per RFC 8414 / RFC 9728 and the MCP authorization spec, a protected
 * resource served at `<base>/mcp/<id>` advertises its metadata at
 * `<base>/.well-known/oauth-protected-resource/mcp/<id>` (the resource path is
 * appended to the well-known prefix). @rekog only serves the ROOT well-known
 * documents, so a spec-compliant client that appends the resource path gets a
 * 404 and cannot complete discovery. Microsoft Copilot Studio's MCP connector
 * also probes `/.well-known/openid-configuration`. These routes fill both gaps.
 *
 * The authorization-server document mirrors what @rekog serves at the root, so
 * existing clients (e.g. Claude) are unaffected; only the previously-404 paths
 * gain a valid response. Routes use an explicit `:serverId` segment (the MCP
 * resource is always `/mcp/<id>`) rather than a wildcard, to avoid any
 * path-matching ambiguity.
 */
@Controller('.well-known')
export class WellKnownOAuthController {
  constructor(private readonly config: ConfigService) {}

  private baseUrl(req: Request): string {
    const proto =
      (req.headers['x-forwarded-proto'] as string) ||
      (req.secure ? 'https' : 'http');
    const host =
      (req.headers['x-forwarded-host'] as string) || req.headers.host;
    return host
      ? `${proto}://${host}`
      : this.config.get<string>('SERVER_URL') || 'http://localhost:4000';
  }

  private authServerMetadata(base: string) {
    return {
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      revocation_endpoint: `${base}/revoke`,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: [
        'authorization_code',
        'refresh_token',
        'client_credentials',
      ],
      token_endpoint_auth_methods_supported: [
        'client_secret_basic',
        'client_secret_post',
        'none',
      ],
      code_challenge_methods_supported: ['S256', 'plain'],
      scopes_supported: ['offline_access'],
      // Minimal OIDC fields so clients that probe openid-configuration accept
      // the document. Tokens are HS256-signed (symmetric), so there is no jwks_uri.
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['HS256'],
    };
  }

  private protectedResourceMetadata(base: string, resourcePath: string) {
    return {
      resource: `${base}${resourcePath}`,
      authorization_servers: [base],
      scopes_supported: ['offline_access'],
      bearer_methods_supported: ['header'],
      mcp_versions_supported: ['2025-06-18'],
    };
  }

  // OIDC discovery (root). Some MCP clients fetch this instead of
  // oauth-authorization-server; we return the same authorization-server doc.
  @Get('openid-configuration')
  openidConfiguration(@Req() req: Request) {
    return this.authServerMetadata(this.baseUrl(req));
  }

  // OIDC discovery (per-server variant).
  @Get('openid-configuration/mcp/:serverId')
  openidConfigurationScoped(@Req() req: Request) {
    return this.authServerMetadata(this.baseUrl(req));
  }

  // Per-server authorization-server metadata (the root path is served by @rekog).
  @Get('oauth-authorization-server/mcp/:serverId')
  authorizationServerScoped(@Req() req: Request) {
    return this.authServerMetadata(this.baseUrl(req));
  }

  // Per-server protected-resource metadata. `resource` is the specific MCP URL.
  @Get('oauth-protected-resource/mcp/:serverId')
  protectedResourceScoped(
    @Req() req: Request,
    @Param('serverId') serverId: string,
  ) {
    return this.protectedResourceMetadata(
      this.baseUrl(req),
      `/mcp/${serverId}`,
    );
  }
}
