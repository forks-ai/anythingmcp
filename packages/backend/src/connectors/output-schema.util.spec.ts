import { inferJsonSchema, mergeSchema, outputSchemaToZodShape } from './output-schema.util';

describe('output-schema.util — prototype-pollution guard', () => {
  it('drops __proto__/constructor/prototype keys from inferred schemas', () => {
    const malicious = JSON.parse('{"safe": 1, "__proto__": {"polluted": true}, "constructor": {"x": 1}}');
    const schema = inferJsonSchema(malicious)!;
    expect(Object.keys(schema.properties)).toEqual(['safe']);
    // The global object prototype must be untouched.
    expect(({} as any).polluted).toBeUndefined();
  });

  it('does not pollute when merging schemas with dangerous keys', () => {
    const a = inferJsonSchema({ a: 1 })!;
    const b = JSON.parse('{"type":"object","properties":{"__proto__":{"polluted":true},"b":{"type":"integer"}}}');
    const merged = mergeSchema(a, b);
    expect(Object.keys(merged.properties).sort()).toEqual(['a', 'b']);
    expect(({} as any).polluted).toBeUndefined();
  });

  it('omits dangerous keys from the served Zod shape', () => {
    const schema = JSON.parse(
      '{"type":"object","properties":{"id":{"type":"string"},"__proto__":{"type":"object"}}}',
    );
    const shape = outputSchemaToZodShape(schema)!;
    expect(Object.keys(shape)).toEqual(['id']);
  });

  it('still infers normal object schemas correctly', () => {
    const schema = inferJsonSchema({ name: 'x', age: 3, ok: true })!;
    expect(schema.type).toBe('object');
    expect(schema.properties.name.type).toBe('string');
    expect(schema.properties.age.type).toBe('integer');
    expect(schema.properties.ok.type).toBe('boolean');
  });
});
