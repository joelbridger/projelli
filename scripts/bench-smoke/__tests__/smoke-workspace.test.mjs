import { describe, it, expect } from 'vitest';
import {
  SMOKE_CLIENT_MATTER_ID,
  SMOKE_CLIENT_NAME,
  SMOKE_NOTE_FILENAME,
  SMOKE_NOTE_FILENAME_SECONDARY,
} from '../checks/smoke-workspace.mjs';

describe('smoke-workspace constants', () => {
  it('are all non-empty strings', () => {
    for (const v of [SMOKE_CLIENT_MATTER_ID, SMOKE_CLIENT_NAME, SMOKE_NOTE_FILENAME, SMOKE_NOTE_FILENAME_SECONDARY]) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it('the note filenames reference the smoke client name', () => {
    expect(SMOKE_NOTE_FILENAME).toContain('Caldwell, Jennifer');
    expect(SMOKE_NOTE_FILENAME_SECONDARY).toContain('Caldwell, Jennifer');
  });

  it('the primary and secondary smoke notes are different files', () => {
    // wave0.mjs and wave2.mjs must not target the same note: root-caused
    // live (2026-07-04) that re-opening a file very soon after a prior
    // check already opened-and-navigated-away-from it can silently fail to
    // render, once both checks could actually reach their note-opening step
    // in the same run (see ensureClientsTableTab's fix).
    expect(SMOKE_NOTE_FILENAME).not.toBe(SMOKE_NOTE_FILENAME_SECONDARY);
  });
});
