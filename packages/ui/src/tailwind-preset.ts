export const chatkitTailwindPreset = {
  theme: {
    extend: {
      colors: {
        'ck-bg': 'var(--ck-color-bg)',
        'ck-surface': 'var(--ck-color-surface)',
        'ck-border': 'var(--ck-color-border)',
        'ck-text': 'var(--ck-color-text)',
        'ck-text-muted': 'var(--ck-color-text-muted)',
        'ck-accent': 'var(--ck-color-accent)',
        'ck-accent-contrast': 'var(--ck-color-accent-contrast)',
        'ck-user-bubble': 'var(--ck-color-user-bubble)',
        'ck-user-bubble-text': 'var(--ck-color-user-bubble-text)',
        'ck-assistant-bubble': 'var(--ck-color-assistant-bubble)',
        'ck-assistant-bubble-text': 'var(--ck-color-assistant-bubble-text)',
        'ck-error': 'var(--ck-color-error)',
        'ck-success': 'var(--ck-color-success)',
      },
      fontFamily: {
        'ck-sans': 'var(--ck-font-sans)',
        'ck-mono': 'var(--ck-font-mono)',
      },
      fontSize: {
        'ck-sm': 'var(--ck-font-size-sm)',
        'ck-base': 'var(--ck-font-size-base)',
        'ck-lg': 'var(--ck-font-size-lg)',
      },
      borderRadius: {
        'ck-sm': 'var(--ck-radius-sm)',
        'ck-md': 'var(--ck-radius-md)',
        'ck-lg': 'var(--ck-radius-lg)',
      },
      spacing: {
        'ck-1': 'var(--ck-space-1)',
        'ck-2': 'var(--ck-space-2)',
        'ck-3': 'var(--ck-space-3)',
        'ck-4': 'var(--ck-space-4)',
        'ck-6': 'var(--ck-space-6)',
      },
    },
  },
};

export default chatkitTailwindPreset;
