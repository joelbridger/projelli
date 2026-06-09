/**
 * WS-PRIV — privilege store + pure resolver.
 *
 * Verifies the per-source privilege map persists tagging decisions, the resolver
 * resolves a source id to its privilege (defaulting to the safe "none"), the
 * include-privileged retrieval toggle defaults OFF, and normalization keeps a
 * file consistent across path-separator differences.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { usePrivilegeStore } from '@/stores/privilegeStore';
import {
  resolvePrivilege,
  normalizeSourceId,
} from '@/modules/memory/privilegeResolver';
import { isPrivileged } from '@/types/privilege';

function resetStore() {
  usePrivilegeStore.setState({ privilegeBySource: {}, includePrivileged: false });
}

describe('privilege resolver (pure)', () => {
  it('resolves an untagged source to "none" (safe default)', () => {
    expect(resolvePrivilege('/ws/Acme/contract.md', {})).toBe('none');
  });

  it('resolves a tagged source to its privilege', () => {
    const map = { '/ws/Acme/memo.md': 'attorney-client' as const };
    expect(resolvePrivilege('/ws/Acme/memo.md', map)).toBe('attorney-client');
  });

  it('normalizes file paths (backslashes, trailing slash) but leaves mail: ids intact', () => {
    expect(normalizeSourceId('C:\\ws\\Acme\\memo.md')).toBe('C:/ws/Acme/memo.md');
    expect(normalizeSourceId('/ws/Acme/')).toBe('/ws/Acme');
    expect(normalizeSourceId('mail:AAMk-123')).toBe('mail:AAMk-123');
  });

  it('resolves consistently across path-separator differences', () => {
    const map = { '/ws/Acme/memo.md': 'work-product' as const };
    // A Windows-style path for the same file resolves to the same entry.
    expect(resolvePrivilege('\\ws\\Acme\\memo.md', map)).toBe('work-product');
  });

  it('isPrivileged is true only for the two privileged statuses', () => {
    expect(isPrivileged('none')).toBe(false);
    expect(isPrivileged('attorney-client')).toBe(true);
    expect(isPrivileged('work-product')).toBe(true);
    expect(isPrivileged(undefined)).toBe(false);
  });
});

describe('privilege store', () => {
  beforeEach(resetStore);

  it('include-privileged defaults to OFF', () => {
    expect(usePrivilegeStore.getState().includePrivileged).toBe(false);
  });

  it('setPrivilege records a non-none status', () => {
    usePrivilegeStore.getState().setPrivilege('/ws/Acme/memo.md', 'attorney-client');
    expect(usePrivilegeStore.getState().getPrivilege('/ws/Acme/memo.md')).toBe(
      'attorney-client',
    );
  });

  it('setPrivilege("none") clears the entry (map stays minimal)', () => {
    const s = usePrivilegeStore.getState();
    s.setPrivilege('/ws/Acme/memo.md', 'work-product');
    expect(Object.keys(usePrivilegeStore.getState().privilegeBySource)).toHaveLength(1);
    s.setPrivilege('/ws/Acme/memo.md', 'none');
    expect(usePrivilegeStore.getState().privilegeBySource).toEqual({});
    expect(usePrivilegeStore.getState().getPrivilege('/ws/Acme/memo.md')).toBe('none');
  });

  it('setPrivilege keys consistently across separators (one entry, not two)', () => {
    const s = usePrivilegeStore.getState();
    s.setPrivilege('/ws/Acme/memo.md', 'attorney-client');
    s.setPrivilege('\\ws\\Acme\\memo.md', 'work-product'); // same file, win-style
    const map = usePrivilegeStore.getState().privilegeBySource;
    expect(Object.keys(map)).toHaveLength(1);
    expect(usePrivilegeStore.getState().getPrivilege('/ws/Acme/memo.md')).toBe(
      'work-product',
    );
  });

  it('setIncludePrivileged flips the retrieval toggle', () => {
    usePrivilegeStore.getState().setIncludePrivileged(true);
    expect(usePrivilegeStore.getState().includePrivileged).toBe(true);
  });
});
