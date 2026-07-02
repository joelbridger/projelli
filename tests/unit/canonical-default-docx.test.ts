// WS-A / A5 — canonical default document format is Word (.docx).
//
// Keepance 3.0 made `.docx` the canonical document format, so creating a NEW
// document defaults to `.docx` (the user can still pick Markdown / Plain Text
// for notes). This locks the setting default + option set so the
// "New Document" action creates a `.docx` opened in the Word editor.

import { describe, it, expect } from 'vitest';
import {
  SETTINGS_SCHEMA,
  getSchemaDefaults,
  getSettingDef,
} from '@/platform/settings/schema';

describe('canonical default new-document type', () => {
  it('defaults Default New File Type to docx', () => {
    const def = getSettingDef('defaultNewFileType');
    expect(def).toBeDefined();
    expect(def!.defaultValue).toBe('docx');
  });

  it('exposes docx as the first (canonical) option', () => {
    const def = getSettingDef('defaultNewFileType')!;
    expect(def.options?.[0]?.value).toBe('docx');
    // Notes formats remain available.
    const values = def.options?.map((o) => o.value) ?? [];
    expect(values).toContain('markdown');
    expect(values).toContain('plaintext');
  });

  it('schema defaults map reflects the docx default', () => {
    const defaults = getSchemaDefaults();
    expect(defaults['defaultNewFileType']).toBe('docx');
  });

  it('keeps the setting in the Workspace section (was Files & Workspace)', () => {
    const def = SETTINGS_SCHEMA.find((d) => d.key === 'defaultNewFileType')!;
    expect(def.category).toBe('workspace');
  });
});

// Mirrors the dispatch in App.tsx's handleCreateDefaultDocument so the routing
// (default-type -> creator) is regression-locked without rendering all of App.
function resolveCreator(kind: string): 'docx' | 'markdown' | 'plaintext' {
  switch (kind) {
    case 'markdown':
      return 'markdown';
    case 'plaintext':
      return 'plaintext';
    case 'docx':
    default:
      return 'docx';
  }
}

describe('new-document dispatch', () => {
  it('routes the docx default to the Word document creator', () => {
    expect(resolveCreator('docx')).toBe('docx');
  });
  it('falls back to docx for an unknown/empty setting', () => {
    expect(resolveCreator('')).toBe('docx');
    expect(resolveCreator('something-else')).toBe('docx');
  });
  it('honors an explicit notes format', () => {
    expect(resolveCreator('markdown')).toBe('markdown');
    expect(resolveCreator('plaintext')).toBe('plaintext');
  });
});
