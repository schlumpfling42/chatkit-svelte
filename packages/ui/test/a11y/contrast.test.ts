import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../../src/a11y/contrast';

describe('contrastRatio', () => {
  it('is 21 for pure black on pure white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('is 1 for identical colors', () => {
    expect(contrastRatio('#4f46e5', '#4f46e5')).toBeCloseTo(1, 5);
  });
});

describe('default theme meets WCAG AA (4.5:1) for text/background token pairs', () => {
  const AA = 4.5;

  it('light theme: body text on bg', () => {
    expect(contrastRatio('#16161a', '#ffffff')).toBeGreaterThanOrEqual(AA);
  });
  it('light theme: user bubble text on user bubble', () => {
    expect(contrastRatio('#ffffff', '#4f46e5')).toBeGreaterThanOrEqual(AA);
  });
  it('light theme: assistant bubble text on assistant bubble', () => {
    expect(contrastRatio('#16161a', '#f2f2f4')).toBeGreaterThanOrEqual(AA);
  });
  it('light theme: accent-contrast text on accent (Send button)', () => {
    expect(contrastRatio('#ffffff', '#4f46e5')).toBeGreaterThanOrEqual(AA);
  });
  it('dark theme: body text on bg', () => {
    expect(contrastRatio('#f2f2f4', '#16161a')).toBeGreaterThanOrEqual(AA);
  });
  it('dark theme: assistant bubble text on assistant bubble', () => {
    expect(contrastRatio('#f2f2f4', '#26262b')).toBeGreaterThanOrEqual(AA);
  });
});
