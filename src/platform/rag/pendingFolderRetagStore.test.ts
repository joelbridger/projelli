/**
 * QA-44 (R7-3) — the durable, per-workspace FILE-folder hold store (the file
 * mirror of the mail hold). Pure set semantics: union `hold`, exact `release`,
 * per-workspace isolation.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  __resetPendingFolderRetagHydrationSuspect,
  pendingFolderRetagHydrationSuspect,
  sanitizePersistedFolderRetag,
  usePendingFolderRetagStore,
} from './pendingFolderRetagStore';
import { workspaceScopeId } from '@/platform/state/workspaceScope';

beforeEach(() => {
  usePendingFolderRetagStore.setState({ heldByWorkspace: {} });
  __resetPendingFolderRetagHydrationSuspect();
});

afterEach(() => {
  __resetPendingFolderRetagHydrationSuspect();
});

describe('pendingFolderRetagStore', () => {
  it('holds and reads per-workspace prefixes', () => {
    const s = usePendingFolderRetagStore.getState();
    s.hold('/wsA', ['/wsA/Acme', '/wsA/Beta/x.docx']);
    expect(s.forWorkspace('/wsA').sort()).toEqual([
      '/wsA/Acme',
      '/wsA/Beta/x.docx',
    ]);
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
    expect(
      '/wsA' in usePendingFolderRetagStore.getState().heldByWorkspace
    ).toBe(false);
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

  it('restores a hold when the same workspace is reopened with equivalent spelling', () => {
    const s = usePendingFolderRetagStore.getState();
    const firstOpen = 'C:\\Practice\\Acme\\.\\';
    const reopened = 'c:/Practice/Acme';

    s.hold(firstOpen, ['C:\\Practice\\Acme\\Client A']);

    expect(s.forWorkspace(reopened)).toEqual(['C:\\Practice\\Acme\\Client A']);

    s.release(reopened, ['C:\\Practice\\Acme\\Client A']);
    expect(s.forWorkspace(firstOpen)).toEqual([]);
  });
});

// F3 (R8) — the folder store, like the mail store, must VALIDATE its hydrated shape.
// A corrupt/partial `localStorage` blob keeps its well-formed per-workspace hold
// lists, drops malformed ones rather than feeding garbage into retrieval filtering,
// and marks the store SUSPECT so the restore can fail closed on all files.
describe('sanitizePersistedFolderRetag (F3 shape validation)', () => {
  it('keeps well-formed workspace holds and does NOT flag suspicion', () => {
    const out = sanitizePersistedFolderRetag({
      heldByWorkspace: { '/wsA': ['/wsA/Acme'] },
    });
    expect(out.heldByWorkspace['/wsA']).toEqual(['/wsA/Acme']);
    expect(pendingFolderRetagHydrationSuspect()).toBe(false);
  });

  it('drops a malformed workspace entry, keeps the good ones, and flags suspicion', () => {
    const out = sanitizePersistedFolderRetag({
      heldByWorkspace: {
        '/wsA': ['/wsA/Acme'],
        '/wsBad': 'not-an-array',
        '/wsMixed': ['/ok', 7],
      },
    });
    expect(out.heldByWorkspace['/wsA']).toEqual(['/wsA/Acme']);
    expect(out.heldByWorkspace['/wsBad']).toBeUndefined();
    expect(out.heldByWorkspace['/wsMixed']).toBeUndefined();
    expect(pendingFolderRetagHydrationSuspect()).toBe(true);
  });

  it('flags a wholly wrong-shaped blob and yields no holds', () => {
    const out = sanitizePersistedFolderRetag({ heldByWorkspace: 'garbage' });
    expect(out.heldByWorkspace).toEqual({});
    expect(pendingFolderRetagHydrationSuspect()).toBe(true);
  });

  it('treats a legitimately empty / absent store as NOT suspect', () => {
    expect(sanitizePersistedFolderRetag(undefined).heldByWorkspace).toEqual({});
    expect(sanitizePersistedFolderRetag(null).heldByWorkspace).toEqual({});
    expect(
      sanitizePersistedFolderRetag({ heldByWorkspace: {} }).heldByWorkspace
    ).toEqual({});
    expect(pendingFolderRetagHydrationSuspect()).toBe(false);
  });

  it('rekeys a legacy raw workspace root during hydration without marking suspicion', () => {
    const rawRoot = 'C:\\Practice\\Acme\\.\\';
    const canonicalRoot = workspaceScopeId(rawRoot);
    const out = sanitizePersistedFolderRetag({
      heldByWorkspace: {
        [rawRoot]: ['C:\\Practice\\Acme\\Client A'],
      },
    });

    expect(out.heldByWorkspace).toEqual({
      [canonicalRoot]: ['C:\\Practice\\Acme\\Client A'],
    });
    expect(pendingFolderRetagHydrationSuspect()).toBe(false);
  });

  it('merges equivalent legacy raw roots into the same hydrated bucket', () => {
    const rawRoot = 'C:\\Practice\\Acme\\.\\';
    const reopened = 'c:/Practice/Acme';
    const canonicalRoot = workspaceScopeId(rawRoot);
    const out = sanitizePersistedFolderRetag({
      heldByWorkspace: {
        [rawRoot]: ['C:\\Practice\\Acme\\Client A'],
        [reopened]: ['C:/Practice/Acme/Client B'],
      },
    });

    expect(out.heldByWorkspace).toEqual({
      [canonicalRoot]: [
        'C:\\Practice\\Acme\\Client A',
        'C:/Practice/Acme/Client B',
      ],
    });
    expect(pendingFolderRetagHydrationSuspect()).toBe(false);
  });
});
