export interface ManagedAgentEnv {
  agentId: string;
  environmentId: string;
}

export function getManagedAgentEnv(): ManagedAgentEnv {
  const agentId = process.env.ANTHROPIC_AGENT_ID;
  const environmentId = process.env.ANTHROPIC_ENVIRONMENT_ID;
  if (!agentId) {
    throw new Error('Missing required environment variable: ANTHROPIC_AGENT_ID');
  }
  if (!environmentId) {
    throw new Error('Missing required environment variable: ANTHROPIC_ENVIRONMENT_ID');
  }
  return { agentId, environmentId };
}
