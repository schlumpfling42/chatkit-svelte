import type { HumanInTheLoopConfig } from './config';

export function needsApproval(toolName: string, config?: HumanInTheLoopConfig): boolean {
  if (!config?.requireApprovalFor?.length) return false;
  if (config.autoApproveTools?.includes(toolName)) return false;
  return config.requireApprovalFor.includes(toolName);
}
