import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('getLlmConfig', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    for (const key of ['OPENAI_MODEL', 'OPENAI_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_SYSTEM_PROMPT']) delete process.env[key];
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('defaults to a local FastFlowLM server and needs only a model', async () => {
    process.env.OPENAI_MODEL = 'llama3.2:1b';
    const { getLlmConfig, DEFAULT_BASE_URL, DEFAULT_SYSTEM_PROMPT } = await import('../src/lib/env');
    expect(getLlmConfig()).toEqual({
      baseUrl: DEFAULT_BASE_URL,
      model: 'llama3.2:1b',
      apiKey: undefined,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
    });
    expect(DEFAULT_BASE_URL).toBe('http://localhost:52625/v1');
  });

  it('honors overrides for any other OpenAI-compatible server', async () => {
    process.env.OPENAI_MODEL = 'gpt-4o-mini';
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_SYSTEM_PROMPT = 'Be terse.';
    const { getLlmConfig } = await import('../src/lib/env');
    expect(getLlmConfig()).toEqual({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: 'sk-test',
      systemPrompt: 'Be terse.',
    });
  });

  it('treats blank optional values as unset', async () => {
    process.env.OPENAI_MODEL = 'm';
    process.env.OPENAI_BASE_URL = '   ';
    process.env.OPENAI_API_KEY = '';
    const { getLlmConfig, DEFAULT_BASE_URL } = await import('../src/lib/env');
    const config = getLlmConfig();
    expect(config.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(config.apiKey).toBeUndefined();
  });

  it('throws naming OPENAI_MODEL (and how to find one) when missing', async () => {
    const { getLlmConfig } = await import('../src/lib/env');
    expect(() => getLlmConfig()).toThrow('OPENAI_MODEL');
    expect(() => getLlmConfig()).toThrow('flm list');
  });
});
