import { describe, expect, it } from 'vitest';
import { validateForm } from '../src/validate';
import type { JSONSchema } from '@chatkit/core';

describe('validateForm', () => {
  it('reports a required field that is missing as an error', () => {
    const schema: JSONSchema = { type: 'object', required: ['name'], properties: { name: { type: 'string' } } };
    expect(validateForm(schema, {})).toEqual({ name: 'This field is required.' });
  });

  it('does not error on an optional field left empty', () => {
    const schema: JSONSchema = { type: 'object', properties: { nickname: { type: 'string' } } };
    expect(validateForm(schema, {})).toEqual({});
  });

  it('enforces minLength/maxLength/pattern on string fields', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { code: { type: 'string', minLength: 3, maxLength: 5, pattern: '^[A-Z]+$' } },
    };
    expect(validateForm(schema, { code: 'ab' }).code).toBe('Must be at least 3 characters.');
    expect(validateForm(schema, { code: 'abcdef' }).code).toBe('Must be at most 5 characters.');
    expect(validateForm(schema, { code: 'abc' }).code).toBe('Invalid format.');
    expect(validateForm(schema, { code: 'ABC' })).toEqual({});
  });

  it('enforces minimum/maximum on number fields', () => {
    const schema: JSONSchema = { type: 'object', properties: { age: { type: 'number', minimum: 18, maximum: 120 } } };
    expect(validateForm(schema, { age: 10 }).age).toBe('Must be at least 18.');
    expect(validateForm(schema, { age: 200 }).age).toBe('Must be at most 120.');
    expect(validateForm(schema, { age: 30 })).toEqual({});
  });

  it('passes a fully valid set of values with no errors', () => {
    const schema: JSONSchema = {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string', minLength: 1 }, age: { type: 'number', minimum: 0 } },
    };
    expect(validateForm(schema, { name: 'Ada', age: 30 })).toEqual({});
  });
});
