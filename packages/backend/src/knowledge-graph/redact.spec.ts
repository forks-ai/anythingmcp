import { redactPii } from './redact';

describe('redactPii', () => {
  it('redacts emails, phones, ids, IBAN, cards — keeps the pattern', () => {
    expect(redactPii('find orders for mario.rossi@acme.com')).toBe('find orders for [email]');
    expect(redactPii('call +39 02 1234 5678 about it')).toContain('[phone]');
    expect(redactPii('customer id 1129945 net price')).toBe('customer id [number] net price');
    expect(redactPii('IBAN DE89370400440532013000 please')).toContain('[iban]');
    expect(redactPii('card 4111 1111 1111 1111')).toContain('[card]');
  });
  it('leaves non-PII text intact', () => {
    expect(redactPii('revenue for ecommerce last week')).toBe('revenue for ecommerce last week');
    expect(redactPii('')).toBe('');
  });
});
