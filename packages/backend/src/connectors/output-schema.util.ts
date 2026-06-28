/**
 * Infer a JSON Schema from a sample response, and build a *permissive* Zod shape
 * to serve it as an MCP tool's outputSchema.
 *
 * Design note: the MCP SDK validates a tool's `structuredContent` against its
 * outputSchema and FAILS the call on mismatch. To never break a working tool we
 * store the rich inferred schema (for our UI / future) but serve a permissive
 * shape (top-level keys as `any`) so validation can't fail, while still giving
 * the client the response's field names.
 */
import { z } from 'zod';

type JsonSchema = Record<string, any>;

const MAX_DEPTH = 6;

// Property names that must never be written from a remote value: assigning to
// `obj['__proto__']` (etc.) pollutes the prototype. The inferred schema is built
// from upstream API responses, which are untrusted. Guarded at each write with a
// direct `=== '__proto__' || …` comparison (the form static analysis recognizes
// as a sanitizer), and the accumulators use `Object.create(null)` so there is no
// prototype to pollute even if a guard were ever missed.

/** Infer a JSON Schema from a sample value (objects/arrays/primitives). */
export function inferJsonSchema(value: unknown, depth = 0): JsonSchema | null {
  if (value === null || value === undefined) return null;
  if (depth > MAX_DEPTH) return {};

  if (Array.isArray(value)) {
    // Merge the first few items into one item schema.
    let items: JsonSchema | null = null;
    for (const el of value.slice(0, 10)) {
      const s = inferJsonSchema(el, depth + 1);
      items = items ? mergeSchema(items, s) : s;
    }
    return { type: 'array', items: items ?? {} };
  }

  if (typeof value === 'object') {
    const properties: Record<string, JsonSchema> = Object.create(null);
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      const s = inferJsonSchema(v, depth + 1);
      if (s) properties[k] = s;
      else properties[k] = {}; // null/unknown leaf
    }
    return { type: 'object', properties, additionalProperties: true };
  }

  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  return { type: 'string' };
}

/** Shallow merge of two inferred schemas (for refining across samples). */
export function mergeSchema(a: JsonSchema | null, b: JsonSchema | null): JsonSchema {
  if (!a) return b ?? {};
  if (!b) return a;
  if (a.type === 'object' && b.type === 'object') {
    const properties: Record<string, JsonSchema> = Object.assign(
      Object.create(null),
      a.properties ?? {},
    );
    for (const [k, v] of Object.entries(b.properties ?? {})) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      properties[k] = properties[k] ? mergeSchema(properties[k], v as JsonSchema) : (v as JsonSchema);
    }
    return { type: 'object', properties, additionalProperties: true };
  }
  if (a.type === 'array' && b.type === 'array') {
    return { type: 'array', items: mergeSchema(a.items ?? null, b.items ?? null) };
  }
  return a.type === b.type ? a : {}; // type drift → loosen to "any"
}

/**
 * Permissive Zod raw shape for serving: one `z.any()` per top-level property of
 * an object schema. Returns null when the schema isn't an object with
 * properties (we only serve outputSchema for object-shaped responses).
 */
export function outputSchemaToZodShape(
  schema: unknown,
): Record<string, z.ZodTypeAny> | null {
  const s = schema as JsonSchema | null;
  if (!s || s.type !== 'object' || !s.properties || typeof s.properties !== 'object') {
    return null;
  }
  const keys = Object.keys(s.properties);
  if (keys.length === 0) return null;
  const shape: Record<string, z.ZodTypeAny> = Object.create(null);
  for (const k of keys) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    shape[k] = z.any();
  }
  return shape;
}
