import { extractIdentifiers, hashValue, isIdentifierLike } from './identifier';

describe('isIdentifierLike', () => {
  it.each([
    ['jane.doe@acme-corp.com', true], // email
    ['550e8400-e29b-41d4-a716-446655440000', true], // uuid
    ['cus_8H2k9Lm3xQ', true], // alnum id with digits
    ['123456', true], // long numeric id
    [99001, true], // big integer id
  ])('%s -> identifier', (v, expected) => {
    expect(isIdentifierLike(v)).toBe(expected);
  });

  it.each([
    ['active', false], // enum word
    ['Jane', false], // short word
    [true, false], // boolean
    [42, false], // small int
    ['New deal title here', false], // multi-word free text
  ])('%s -> not identifier', (v, expected) => {
    expect(isIdentifierLike(v)).toBe(expected);
  });
});

describe('extractIdentifiers', () => {
  it('pulls leaf identifier fields and skips noise', () => {
    const got = extractIdentifiers({
      id: 99001,
      name: 'Jane Doe',
      email: 'jane@acme.com',
      value: 5000, // stoplisted numeric
      nested: { person_id: 99001, status: 'won' },
    });
    const fields = got.map((g) => g.field).sort();
    expect(fields).toEqual(['email', 'id', 'person_id']);
  });
});

describe('hashValue', () => {
  it('is deterministic within an org but differs across orgs (tenant isolation)', () => {
    const a1 = hashValue('orgA', 'cus_123456');
    const a2 = hashValue('orgA', 'cus_123456');
    const b1 = hashValue('orgB', 'cus_123456');
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b1);
  });

  it('never returns the raw value', () => {
    const h = hashValue('orgA', 'jane@acme.com');
    expect(h).not.toContain('jane');
    expect(h).toMatch(/^[0-9a-f]{40}$/);
  });
});
