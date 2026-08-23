export interface BackoffOptions {
  /** Base delay in ms before the first retry. Default 500. */
  base?: number;
  /** Multiplier applied per attempt. Default 2. */
  factor?: number;
  /** Ceiling for the delay, before jitter is applied. Default 15000. */
  max?: number;
  /** Jitter as a fraction of the delay (0.2 = ±20%). Default 0.2. */
  jitter?: number;
  /** Random source, injectable for deterministic tests. Default Math.random. */
  random?: () => number;
}

/**
 * Computes the delay (ms) before retry number `attempt` (1-indexed: the delay
 * before the FIRST retry is attempt=1). Exponential backoff capped at `max`,
 * with symmetric jitter applied on top of the capped value.
 */
export function computeBackoffDelay(attempt: number, options: BackoffOptions = {}): number {
  const base = options.base ?? 500;
  const factor = options.factor ?? 2;
  const max = options.max ?? 15000;
  const jitter = options.jitter ?? 0.2;
  const random = options.random ?? Math.random;

  const exponential = base * factor ** Math.max(0, attempt - 1);
  const capped = Math.min(exponential, max);
  const jitterRange = capped * jitter;
  const jitterOffset = (random() * 2 - 1) * jitterRange;
  return Math.max(0, Math.round(capped + jitterOffset));
}
