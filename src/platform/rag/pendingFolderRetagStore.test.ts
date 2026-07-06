/**
 * QA-44 (R7-3) — the durable, per-workspace FILE-folder hold store (the file
 * mirror of the mail hold). Pure set semantics: union `hold`, exact `release`,
 * per-workspace isolation.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { usePendingFolderRetagStore } from './pendingFolderRetagStore';

beforeEach(() => {
  usePendingFolderRetagStore.setState({ heldByWorkspace: {} });
});

describe('pendingFolderRetagStore', () => {
  it('holds and reads per-workspace prefixes', () => {
    const s = usePendingFolderRetagStore.getState();
    s.hold('/wsA', ['/wsA/Acme', '/wsA/Beta/x.docx']);
    expect(s.forWorkspace('/wsA').sort()).toEqual(['/wsA/Acme', '/wsA/Beta/x.docx']);
    expect(s.forWorkspace('/wsB')).toEqual([]);
  });

  it('unions holds without duplicates', () => {
    const s = usePendingFolderRetagStore.getState();
    s.hold('/wsA', ['/wsA/Acme']);
    s.hold('/wsA', ['/wsA/Acme', '/wsA/Beta']);
    expect(s.forWorkspace('/wsA').sort()).toEqual(['/wsA/Acme', '/wsA/Beta']);
  });

  it('releases exact prefixes and removes the workspace key when empty', () => {
    const s = usePendingFolderRetagStore.getState();
    s.hold('/wsA', ['/wsA/Acme', '/wsA/Beta']);
    s.release('/wsA', ['/wsA/Acme']);
    expect(s.forWorkspace('/wsA')).toEqual(['/wsA/Beta']);
    s.release('/wsA', ['/wsA/Beta']);
    expect(s.forWorkspace('/wsA')).toEqual([]);
    expect('/wsA' in usePendingFolderRetagStore.getState().heldByWorkspace).toBe(false);
  });

  it('a no-op release (nothing overlapped) leaves the set unchanged', () => {
    const s = usePendingFolderRetagStore.getState();
    s.hold('/wsA', ['/wsA/Acme']);
    s.release('/wsA', ['/wsA/NotHeld']);
    expect(s.forWorkspace('/wsA')).toEqual(['/wsA/Acme']);
  });

  it('keeps workspaces isolated across hold/clear', () => {
    const s = usePendingFolderRetagStore.getState();
    s.hold('/wsA', ['/wsA/Acme']);
    s.hold('/wsB', ['/wsB/Zed']);
    s.clearWorkspace('/wsA');
    expect(s.forWorkspace('/wsA')).toEqual([]);
    expect(s.forWorkspace('/wsB')).toEqual(['/wsB/Zed']);
  });

  it('ignores empty inputs', () => {
    const s = usePendingFolderRetagStore.getState();
    s.hold('', ['/x']);
    s.hold('/wsA', []);
    expect(usePendingFolderRetagStore.getState().heldByWorkspace).toEqual({});
  });
});
