import { McpOAuthService } from './mcp-oauth.service';
import axios from 'axios';

jest.mock('axios');
// assertSafeOutboundUrl performs DNS/SSRF checks — stub it out for unit tests.
jest.mock('../common/ssrf.util', () => ({
  assertSafeOutboundUrl: jest.fn().mockResolvedValue(undefined),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('McpOAuthService.exchangeCodeForTokens client authentication', () => {
  let service: McpOAuthService;

  beforeEach(() => {
    service = new McpOAuthService();
    mockedAxios.post.mockReset();
    mockedAxios.post.mockResolvedValue({
      data: { access_token: 'at', refresh_token: 'rt', expires_in: 3600 },
    } as any);
  });

  const baseParams = {
    tokenUrl: 'https://sandbox-api.datev.de/token',
    code: 'authcode',
    redirectUri: 'https://cloud.anythingmcp.com/api/mcp-oauth/callback',
    clientId: 'cid',
    clientSecret: 'secret',
    codeVerifier: 'verifier',
  };

  it('defaults to client_secret_post (credentials in body, no Basic header)', async () => {
    await service.exchangeCodeForTokens({ ...baseParams });

    const [, body, config] = mockedAxios.post.mock.calls[0];
    expect(String(body)).toContain('client_secret=secret');
    expect((config as any).headers.Authorization).toBeUndefined();
  });

  it('uses client_secret_basic when tokenAuthMethod=basic (header, not body)', async () => {
    await service.exchangeCodeForTokens({
      ...baseParams,
      tokenAuthMethod: 'basic',
    });

    const [, body, config] = mockedAxios.post.mock.calls[0];
    // Secret must NOT be in the body...
    expect(String(body)).not.toContain('client_secret=');
    // ...but in the Authorization header as base64(client_id:client_secret).
    const expected =
      'Basic ' + Buffer.from('cid:secret').toString('base64');
    expect((config as any).headers.Authorization).toBe(expected);
    // client_id still present in the body per RFC 6749.
    expect(String(body)).toContain('client_id=cid');
  });

  it("treats 'client_secret_basic' as an alias for basic", async () => {
    await service.exchangeCodeForTokens({
      ...baseParams,
      tokenAuthMethod: 'client_secret_basic',
    });
    const [, , config] = mockedAxios.post.mock.calls[0];
    expect((config as any).headers.Authorization).toMatch(/^Basic /);
  });
});
