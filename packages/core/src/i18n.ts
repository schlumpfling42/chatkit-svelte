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
  'composer.removeAttachment': 'Remove attachment',
  'composer.attachmentImage': 'Image',
  'working.label': 'The assistant is working',
  // Pipe-separated; shown one at a time while the assistant works. Replace or translate freely.
  'working.words':
    'Tinkering|Contemplating|Pondering|Noodling|Cogitating|Ruminating|Percolating|Musing|Mulling it over|Brewing|Conjuring|Puzzling|Untangling|Hatching a plan|Connecting dots|Whirring',
  'composer.attachmentUnsupported': '“{name}” can’t be attached: that file type isn’t supported here. Supported: {types}.',
  'composer.attachmentTooLarge': '“{name}” is too large (the limit is {max}).',
  'composer.attachmentFailed': '“{name}” couldn’t be attached.',
  'approvalBar.approve': 'Approve',
  'approvalBar.reject': 'Reject',
  'approvalBar.edit': 'Edit',
  'approvalBar.retry': 'Retry',
  'approvalBar.cancel': 'Cancel',
  'form.submit': 'Submit',
  'form.validation.required': 'This field is required.',
  'form.score': 'Score: {correct} / {total}',
  'form.html.submitted': 'Submitted.',
  'document.edit': 'Edit',
  'document.save': 'Save',
  'document.cancel': 'Cancel',
  'document.export': 'Export {format}',
  'fileRequest.attach': 'Attach file',
  'fileRequest.unsupportedType': 'That file type isn’t accepted here.',
  'fileRequest.tooLarge': 'That file is too large.',
  'fileRequest.failed': 'That file couldn’t be uploaded. Try again.',
  'fileRequest.pending': 'Waiting for a file…',
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
