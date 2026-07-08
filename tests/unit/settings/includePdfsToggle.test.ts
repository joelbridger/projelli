/**
 * Plan A3 - includePdfsInWorkspaceIndex setting smoke tests.
 *
 * v3.3: memory lives under the top-level AI section.
 * The schema category still accepts 'ai-privacy' as a compatibility alias.
 * Use resolveSection('memory') === 'ai' to confirm the alias still works.
 */
import { describe, it, expect } from 'vitest';
import { SETTINGS_SCHEMA, resolveSection } from '@/platform/settings/schema';

describe('includePdfsInWorkspaceIndex setting', () => {
  const entry = SETTINGS_SCHEMA.find((s) => s.key === 'includePdfsInWorkspaceIndex');

  it('exists in schema', () => {
    expect(entry).toBeDefined();
  });

  it('resolves to the AI section (Memory group)', () => {
    expect(entry?.category).toBe('ai-privacy');
    expect(resolveSection('memory')).toBe('ai');
  });

  it('defaults to true (PDF search on out of the box; BUG-015 follow-up, 2026-06-20)', () => {
    expect(entry?.defaultValue).toBe(true);
  });

  it('is a toggle type', () => {
    expect(entry?.type).toBe('toggle');
  });
});
