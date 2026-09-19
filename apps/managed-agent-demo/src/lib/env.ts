export interface LlmConfig {
  /** Base URL of an OpenAI-compatible server, including the `/v1` (or equivalent) prefix. */
  baseUrl: string;
  model: string;
  /** Only needed for hosted servers; local ones (FastFlowLM, Ollama, LM Studio) ignore it. */
  apiKey?: string;
  systemPrompt: string;
}

/** FastFlowLM's `flm serve` default. */
export const DEFAULT_BASE_URL = 'http://localhost:52625/v1';

export const DEFAULT_SYSTEM_PROMPT = [
  'You are a helpful assistant in a chat interface. Keep responses concise.',
  'When you need several distinct pieces of information from the user (ratings, choices, several fields), call show_form instead of asking in prose.',
  'When you need a file from the user, call request_file. When the user wants a document you have written, call create_document with markdown content.',
  'Only call a tool when it is actually needed, and always give tool arguments as valid JSON.',
].join('\n');

export function getLlmConfig(): LlmConfig {
  const model = process.env.OPENAI_MODEL?.trim();
  if (!model) {
    throw new Error('Missing required environment variable: OPENAI_MODEL (for FastFlowLM, `flm list` shows the available tags, e.g. llama3.2:1b)');
  }
  const baseUrl = process.env.OPENAI_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const apiKey = process.env.OPENAI_API_KEY?.trim() || undefined;
  const systemPrompt = process.env.OPENAI_SYSTEM_PROMPT?.trim() || DEFAULT_SYSTEM_PROMPT;
  return { baseUrl, model, apiKey, systemPrompt };
}
