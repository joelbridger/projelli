/**
 * Plan A3 - includePdfsInWorkspaceIndex setting smoke tests.
 *
 * v3.1: the "memory" sub-section now lives inside the "ai-privacy" section.
 * The schema category for this setting is 'ai-privacy' (the canonical section).
 * Use resolveSection('memory') === 'ai-privacy' to confirm the alias still works.
 */
import { describe, it, expect } from 'vitest';
import { SETTINGS_SCHEMA, resolveSection } from '@/settings/schema';

describe('includePdfsInWorkspaceIndex setting', () => {
  const entry = SETTINGS_SCHEMA.find((s) => s.key === 'includePdfsInWorkspaceIndex');

  it('exists in schema', () => {
    expect(entry).toBeDefined();
  });

  it('is in the ai-privacy section (Memory sub-section)', () => {
    // The setting moved from the standalone "memory" category into the
    // "ai-privacy" section. resolveSection('memory') confirms the alias works.
    expect(entry?.category).toBe('ai-privacy');
    expect(resolveSection('memory')).toBe('ai-privacy');
  });

  it('defaults to false', () => {
    expect(entry?.defaultValue).toBe(false);
  });

  it('is a toggle type', () => {
    expect(entry?.type).toBe('toggle');
  });
});
