import { describe, it, expect } from 'vitest';
import { SMOKE_CLIENT_MATTER_ID, SMOKE_CLIENT_NAME, SMOKE_NOTE_FILENAME } from '../checks/smoke-workspace.mjs';

describe('smoke-workspace constants', () => {
  it('are all non-empty strings', () => {
    for (const v of [SMOKE_CLIENT_MATTER_ID, SMOKE_CLIENT_NAME, SMOKE_NOTE_FILENAME]) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it('the note filename references the smoke client name', () => {
    expect(SMOKE_NOTE_FILENAME).toContain('Caldwell, Jennifer');
  });
});
