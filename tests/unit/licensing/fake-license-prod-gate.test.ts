/**
 * Licensing audit — the `?fakeLicense=` QA bypass must be DEV-only. In a
 * production build it must NOT unlock any paid tier, or a user could grant
 * themselves Firm features just by adding a URL param.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLicense } from '@/platform/hooks/useLicense';

function setSearch(search: string) {
  window.history.replaceState(null, '', `/${search}`);
}

describe('?fakeLicense production gate', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    setSearch('');
  });

  it('IGNORES ?fakeLicense=practice in a production build (DEV=false)', () => {
    vi.stubEnv('DEV', false);
    setSearch('?fakeLicense=practice');
    const { result } = renderHook(() => useLicense());
    // Must NOT be activated as Firm/practice from a mere URL param.
    expect(result.current.isActivated).toBe(false);
    expect(result.current.tier).not.toBe('practice');
  });

  it('HONORS ?fakeLicense=practice on the dev server (DEV=true) — QA bypass still works', () => {
    vi.stubEnv('DEV', true);
    setSearch('?fakeLicense=practice');
    const { result } = renderHook(() => useLicense());
    expect(result.current.isActivated).toBe(true);
    expect(result.current.tier).toBe('practice');
  });
});
