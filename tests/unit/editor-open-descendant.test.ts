/**
 * hasOpenDescendant — guards AI folder move/delete (and batch undo) against
 * leaving an open child tab stale, which the 2s autosave could re-write back
 * (resurrecting a deleted file / duplicating after a move).
 */
import { describe, it, expect } from 'vitest';
import { hasOpenDescendant } from '@/platform/state/editorStore';

const tab = (path: string, type?: string) => ({ path, type });

describe('hasOpenDescendant', () => {
  it('is true when a file inside the folder is open', () => {
    expect(hasOpenDescendant('/ws/Clients/Acme', [tab('/ws/Clients/Acme/brief.md')])).toBe(true);
  });

  it('is false when nothing under the folder is open', () => {
    expect(hasOpenDescendant('/ws/Clients/Acme', [tab('/ws/Clients/Beta/x.md')])).toBe(false);
  });

  it('does not treat the folder path itself as a descendant', () => {
    expect(hasOpenDescendant('/ws/Clients/Acme', [tab('/ws/Clients/Acme')])).toBe(false);
  });

  it('is not fooled by a sibling folder sharing a name prefix', () => {
    // "/ws/Clients/Acme2/x.md" must NOT count as inside "/ws/Clients/Acme".
    expect(hasOpenDescendant('/ws/Clients/Acme', [tab('/ws/Clients/Acme2/x.md')])).toBe(false);
  });

  it('ignores non-file tab types (browser / ai-assistant / email)', () => {
    expect(hasOpenDescendant('/ws/Clients/Acme', [tab('/ws/Clients/Acme/chat', 'ai-assistant')])).toBe(false);
  });
});
