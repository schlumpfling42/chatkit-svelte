export interface I18nConfig {
  locale: string;
  messages: Record<string, string>;
  formatDate?(ts: number, locale: string): string;
}

export const defaultMessages: Record<string, string> = {
  'composer.placeholder': 'Type a message…',
  'composer.inputLabel': 'Message',
  'composer.send': 'Send',
  'composer.attach': 'Attach',
  'approvalBar.approve': 'Approve',
  'approvalBar.reject': 'Reject',
  'approvalBar.edit': 'Edit',
  'approvalBar.retry': 'Retry',
  'approvalBar.cancel': 'Cancel',
  'form.submit': 'Submit',
  'form.validation.required': 'This field is required.',
  'document.edit': 'Edit',
  'document.save': 'Save',
  'document.cancel': 'Cancel',
  'document.export': 'Export {format}',
};

const RTL_LOCALES = new Set(['ar', 'he', 'fa', 'ur']);

export function directionForLocale(locale: string | undefined): 'ltr' | 'rtl' {
  if (!locale) return 'ltr';
  const base = locale.split('-')[0].toLowerCase();
  return RTL_LOCALES.has(base) ? 'rtl' : 'ltr';
}

export function translate(messages: Record<string, string>, key: string, params?: Record<string, string>): string {
  const template = messages[key] ?? defaultMessages[key] ?? key;
  if (!params) return template;
  return Object.entries(params).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, v), template);
}
