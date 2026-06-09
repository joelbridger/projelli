/**
 * WS-PRIV — wiring: changing a source's privilege re-tags its indexed chunks.
 *
 * Covers:
 *   - `changedPrivilegeSources` diff (added / value-changed / cleared).
 *   - Mounting `useMemoryWiring` subscribes to the privilege store and calls
 *     `MemoryService.retagPrivilege` for any source whose privilege changes,
 *     with the NEW value (a cleared entry re-tags back to "none").
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

// Mock Tauri so the per-workspace lifecycle effect short-circuits cleanly and
// the privilege re-tag reaction is the only thing exercised.
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }));

const mem = vi.hoisted(() => ({
  retagPrivilege: vi.fn(),
  reindexPaths: vi.fn(),
  setWorkspace: vi.fn(),
  indexWorkspace: vi.fn(),
  deletePath: vi.fn(),
  indexFile: vi.fn(),
  indexPdfFile: vi.fn(),
}));

vi.mock('@/modules/memory/MemoryService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/memory/MemoryService')>();
  return {
    ...actual,
    MemoryService: { ...actual.MemoryService, ...mem },
  };
});

import {
  changedPrivilegeSources,
  useMemoryWiring,
} from '@/hooks/useMemoryWiring';
import { usePrivilegeStore } from '@/stores/privilegeStore';

describe('changedPrivilegeSources (pure diff)', () => {
  it('detects added, value-changed, and cleared sources', () => {
    const prev = { '/a.md': 'attorney-client' as const, '/b.md': 'work-product' as const };
    const next = {
      '/a.md': 'work-product' as const, // value changed
      '/c.md': 'attorney-client' as const, // added
      // '/b.md' removed (cleared back to none)
    };
    const changed = changedPrivilegeSources(prev, next).sort();
    expect(changed).toEqual(['/a.md', '/b.md', '/c.md']);
  });

  it('returns empty when nothing changed', () => {
    const map = { '/a.md': 'attorney-client' as const };
    expect(changedPrivilegeSources(map, { ...map })).toEqual([]);
  });
});

function Harness({ root }: { root: string }) {
  useMemoryWiring(root, {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    exists: vi.fn(),
  });
  return null;
}

describe('useMemoryWiring re-tags on privilege change', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePrivilegeStore.setState({ privilegeBySource: {}, includePrivileged: false });
    mem.retagPrivilege.mockResolvedValue(1);
  });
  afterEach(cleanup);

  it('marking a source privileged calls retagPrivilege with the new value', async () => {
    render(<Harness root="/ws" />);

    usePrivilegeStore.getState().setPrivilege('/ws/Acme/memo.md', 'attorney-client');

    await waitFor(() => {
      expect(mem.retagPrivilege).toHaveBeenCalledWith(
        '/ws/Acme/memo.md',
        'attorney-client',
      );
    });
  });

  it('clearing a source re-tags it back to "none"', async () => {
    // Seed an existing privileged entry, then mount + clear it.
    usePrivilegeStore.setState({
      privilegeBySource: { '/ws/Acme/memo.md': 'work-product' },
      includePrivileged: false,
    });
    render(<Harness root="/ws" />);

    usePrivilegeStore.getState().setPrivilege('/ws/Acme/memo.md', 'none');

    await waitFor(() => {
      expect(mem.retagPrivilege).toHaveBeenCalledWith('/ws/Acme/memo.md', 'none');
    });
  });
});
