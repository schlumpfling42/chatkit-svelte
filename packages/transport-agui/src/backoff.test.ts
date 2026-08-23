import { describe, expect, it } from 'vitest';
import { computeBackoffDelay } from './backoff';

describe('computeBackoffDelay', () => {
  it('returns base delay for the first retry with no jitter', () => {
    const delay = computeBackoffDelay(1, { base: 500, factor: 2, max: 15000, jitter: 0, random: () => 0.5 });
    expect(delay).toBe(500);
  });

  it('doubles per attempt with the default factor', () => {
    const opts = { base: 500, factor: 2, max: 15000, jitter: 0, random: () => 0.5 };
    expect(computeBackoffDelay(1, opts)).toBe(500);
    expect(computeBackoffDelay(2, opts)).toBe(1000);
    expect(computeBackoffDelay(3, opts)).toBe(2000);
    expect(computeBackoffDelay(4, opts)).toBe(4000);
  });

  it('caps the exponential growth at max before jitter', () => {
    const delay = computeBackoffDelay(10, { base: 500, factor: 2, max: 15000, jitter: 0, random: () => 0.5 });
    expect(delay).toBe(15000);
  });

  it('applies symmetric jitter within ±jitter fraction of the capped delay', () => {
    const opts = { base: 500, factor: 2, max: 15000, jitter: 0.2 };
    const atMinRandom = computeBackoffDelay(1, { ...opts, random: () => 0 });
    const atMaxRandom = computeBackoffDelay(1, { ...opts, random: () => 1 });
    const atMidRandom = computeBackoffDelay(1, { ...opts, random: () => 0.5 });
    expect(atMinRandom).toBe(400); // 500 - 20%
    expect(atMaxRandom).toBe(600); // 500 + 20%
    expect(atMidRandom).toBe(500); // no offset at random()=0.5
  });

  it('never returns a negative delay even with extreme jitter', () => {
    const delay = computeBackoffDelay(1, { base: 10, factor: 2, max: 15000, jitter: 1, random: () => 0 });
    expect(delay).toBeGreaterThanOrEqual(0);
  });

  it('treats attempt <= 1 the same as attempt 1 (no negative exponents)', () => {
    const opts = { base: 500, factor: 2, max: 15000, jitter: 0, random: () => 0.5 };
    expect(computeBackoffDelay(0, opts)).toBe(500);
    expect(computeBackoffDelay(1, opts)).toBe(500);
  });

  it('uses documented defaults when no options are passed', () => {
    const delay = computeBackoffDelay(1);
    expect(delay).toBeGreaterThanOrEqual(400);
    expect(delay).toBeLessThanOrEqual(600);
  });
});
