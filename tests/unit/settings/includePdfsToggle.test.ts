/**
 * Plan A3 - includePdfsInWorkspaceIndex setting smoke tests.
 */
import { describe, it, expect } from 'vitest';
import { SETTINGS_SCHEMA } from '@/settings/schema';

describe('includePdfsInWorkspaceIndex setting', () => {
  const entry = SETTINGS_SCHEMA.find((s) => s.key === 'includePdfsInWorkspaceIndex');

  it('exists in schema', () => {
    expect(entry).toBeDefined();
  });

  it('is in memory category', () => {
    expect(entry?.category).toBe('memory');
  });

  it('defaults to false', () => {
    expect(entry?.defaultValue).toBe(false);
  });

  it('is a toggle type', () => {
    expect(entry?.type).toBe('toggle');
  });
});
