import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('getManagedAgentEnv', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.ANTHROPIC_AGENT_ID;
    delete process.env.ANTHROPIC_ENVIRONMENT_ID;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns agentId and environmentId when both are set', async () => {
    process.env.ANTHROPIC_AGENT_ID = 'agent_123';
    process.env.ANTHROPIC_ENVIRONMENT_ID = 'env_456';
    const { getManagedAgentEnv } = await import('../src/lib/env');
    expect(getManagedAgentEnv()).toEqual({ agentId: 'agent_123', environmentId: 'env_456' });
  });

  it('throws naming ANTHROPIC_AGENT_ID when missing', async () => {
    process.env.ANTHROPIC_ENVIRONMENT_ID = 'env_456';
    const { getManagedAgentEnv } = await import('../src/lib/env');
    expect(() => getManagedAgentEnv()).toThrow('ANTHROPIC_AGENT_ID');
  });

  it('throws naming ANTHROPIC_ENVIRONMENT_ID when missing', async () => {
    process.env.ANTHROPIC_AGENT_ID = 'agent_123';
    const { getManagedAgentEnv } = await import('../src/lib/env');
    expect(() => getManagedAgentEnv()).toThrow('ANTHROPIC_ENVIRONMENT_ID');
  });
});
