import { describe, expect, it } from 'vitest';
import { defaultMessages, directionForLocale, translate } from './i18n';

describe('translate', () => {
  it('returns the default English message for a known key with no overrides', () => {
    expect(translate({}, 'composer.send')).toBe('Send');
  });

  it('prefers a per-key override over the default', () => {
    expect(translate({ 'composer.send': 'Envoyer' }, 'composer.send')).toBe('Envoyer');
  });

  it('falls back to the raw key when there is no default or override', () => {
    expect(translate({}, 'totally.unknown.key')).toBe('totally.unknown.key');
  });

  it('interpolates {param} placeholders', () => {
    expect(translate(defaultMessages, 'document.export', { format: 'pdf' })).toBe('Export pdf');
  });
});

describe('directionForLocale', () => {
  it('returns ltr for English and when no locale is given', () => {
    expect(directionForLocale('en')).toBe('ltr');
    expect(directionForLocale(undefined)).toBe('ltr');
  });

  it('returns rtl for Arabic and Hebrew, including region-suffixed locale tags', () => {
    expect(directionForLocale('ar')).toBe('rtl');
    expect(directionForLocale('he-IL')).toBe('rtl');
  });
});
