import { describe, expect, it } from 'vitest';
import { chatkitTailwindPreset } from '../src/tailwind-preset';

describe('chatkitTailwindPreset', () => {
  it('maps every color token to its CSS custom property', () => {
    expect(chatkitTailwindPreset.theme.extend.colors['ck-accent']).toBe('var(--ck-color-accent)');
    expect(chatkitTailwindPreset.theme.extend.colors['ck-bg']).toBe('var(--ck-color-bg)');
  });

  it('maps spacing/radius/font tokens to their CSS custom properties', () => {
    expect(chatkitTailwindPreset.theme.extend.spacing['ck-4']).toBe('var(--ck-space-4)');
    expect(chatkitTailwindPreset.theme.extend.borderRadius['ck-md']).toBe('var(--ck-radius-md)');
    expect(chatkitTailwindPreset.theme.extend.fontFamily['ck-sans']).toBe('var(--ck-font-sans)');
  });
});
