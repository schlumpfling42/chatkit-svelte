import type { JSONSchema } from '@chatkit-svelte/core';

function isRequired(schema: JSONSchema, field: string): boolean {
  const required = schema.required as string[] | undefined;
  return Array.isArray(required) && required.includes(field);
}

export function validateField(fieldSchema: JSONSchema, value: unknown, required: boolean): string | undefined {
  const isEmpty = value === undefined || value === null || value === '';
  if (required && isEmpty) return 'This field is required.';
  if (isEmpty) return undefined;

  const type = fieldSchema.type as string | undefined;
  if (type === 'string' && typeof value === 'string') {
    const minLength = fieldSchema.minLength as number | undefined;
    const maxLength = fieldSchema.maxLength as number | undefined;
    const pattern = fieldSchema.pattern as string | undefined;
    if (minLength !== undefined && value.length < minLength) return `Must be at least ${minLength} characters.`;
    if (maxLength !== undefined && value.length > maxLength) return `Must be at most ${maxLength} characters.`;
    if (pattern !== undefined && !new RegExp(pattern).test(value)) return 'Invalid format.';
  }
  if (type === 'number' || type === 'integer') {
    const num = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(num)) return 'Must be a number.';
    const minimum = fieldSchema.minimum as number | undefined;
    const maximum = fieldSchema.maximum as number | undefined;
    if (minimum !== undefined && num < minimum) return `Must be at least ${minimum}.`;
    if (maximum !== undefined && num > maximum) return `Must be at most ${maximum}.`;
  }
  return undefined;
}

export function validateForm(schema: JSONSchema, values: Record<string, unknown>): Record<string, string> {
  const properties = (schema.properties as Record<string, JSONSchema>) ?? {};
  const errors: Record<string, string> = {};
  for (const [field, fieldSchema] of Object.entries(properties)) {
    const error = validateField(fieldSchema, values[field], isRequired(schema, field));
    if (error) errors[field] = error;
  }
  return errors;
}
