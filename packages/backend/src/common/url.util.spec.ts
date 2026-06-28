import { BadRequestException } from '@nestjs/common';
import { normalizeConnectorBaseUrl } from './url.util';

describe('normalizeConnectorBaseUrl', () => {
  it('keeps a well-formed https URL untouched', () => {
    expect(
      normalizeConnectorBaseUrl('https://api.example.com/v1', 'REST'),
    ).toBe('https://api.example.com/v1');
  });

  it('prepends https:// when the scheme is missing', () => {
    expect(normalizeConnectorBaseUrl('api.na1.insightly.com/v3.1', 'REST')).toBe(
      'https://api.na1.insightly.com/v3.1',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeConnectorBaseUrl('  https://api.example.com  ', 'REST')).toBe(
      'https://api.example.com',
    );
  });

  it('rejects a malformed scheme like "api.https://…" (the production mangling)', () => {
    expect(() =>
      normalizeConnectorBaseUrl('api.https://na1.insightly.com', 'REST'),
    ).toThrow(BadRequestException);
  });

  it('rejects an empty base URL', () => {
    expect(() => normalizeConnectorBaseUrl('   ', 'REST')).toThrow(
      BadRequestException,
    );
  });

  it('rejects a non-http scheme for HTTP connectors', () => {
    expect(() =>
      normalizeConnectorBaseUrl('ftp://files.example.com', 'REST'),
    ).toThrow(BadRequestException);
  });

  it('leaves DATABASE connector URLs untouched (own scheme)', () => {
    expect(
      normalizeConnectorBaseUrl('mysql://user:pass@db.example.com:3306/app', 'DATABASE'),
    ).toBe('mysql://user:pass@db.example.com:3306/app');
  });

  it('defaults to HTTP normalization when type is omitted', () => {
    expect(normalizeConnectorBaseUrl('api.example.com')).toBe(
      'https://api.example.com',
    );
  });
});
