import { describe, expect, it } from 'vitest';
import { needsApproval } from './human-in-the-loop';

describe('needsApproval', () => {
  it('returns false when no humanInTheLoop config is provided', () => {
    expect(needsApproval('search', undefined)).toBe(false);
  });

  it('returns false when requireApprovalFor is empty or absent', () => {
    expect(needsApproval('search', {})).toBe(false);
  });

  it('returns true when the tool name is listed in requireApprovalFor', () => {
    expect(needsApproval('search', { requireApprovalFor: ['search'] })).toBe(true);
  });

  it('returns false for a tool not listed in requireApprovalFor', () => {
    expect(needsApproval('search', { requireApprovalFor: ['delete_file'] })).toBe(false);
  });

  it('autoApproveTools overrides requireApprovalFor for the same tool name', () => {
    expect(needsApproval('search', { requireApprovalFor: ['search'], autoApproveTools: ['search'] })).toBe(false);
  });
});
