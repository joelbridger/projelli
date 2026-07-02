// Jameson's call (2026-06-20): "search your scanned filings" is core to the
// pitch, so PDF indexing should work out of the box. This pins the default ON
// so it can't silently regress (the OFF default was the root of BUG-015 — a
// scanned PDF added to the workspace was silently not searchable).

import { describe, it, expect } from 'vitest';
import { SETTINGS_SCHEMA, getSchemaDefaults } from '@/platform/settings/schema';

describe('includePdfsInWorkspaceIndex default (BUG-015 follow-up)', () => {
  it('defaults to ON so PDFs are searchable out of the box', () => {
    const def = SETTINGS_SCHEMA.find((d) => d.key === 'includePdfsInWorkspaceIndex');
    expect(def).toBeDefined();
    expect(def!.defaultValue).toBe(true);
  });

  it('getSchemaDefaults() reflects the ON default', () => {
    expect(getSchemaDefaults()['includePdfsInWorkspaceIndex']).toBe(true);
  });
});
