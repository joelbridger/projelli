import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { isNewNavEnabled, useNewNav, NEW_NAV_FLAG_KEY } from '@/platform/flags/newNav';

/** Swap window.location.search safely in jsdom. */
function setSearch(search: string): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, search },
  });
}

describe('newNav feature flag', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setSearch('');
  });
  afterEach(() => {
    window.localStorage.clear();
    setSearch('');
  });

  it('defaults OFF with no URL param and no stored preference', () => {
    expect(isNewNavEnabled()).toBe(false);
  });

  it('turns ON via ?newNav=1', () => {
    setSearch('?newNav=1');
    expect(isNewNavEnabled()).toBe(true);
  });

  it('turns ON via ?newNav=true', () => {
    setSearch('?newNav=true');
    expect(isNewNavEnabled()).toBe(true);
  });

  it('turns ON via localStorage', () => {
    window.localStorage.setItem(NEW_NAV_FLAG_KEY, '1');
    expect(isNewNavEnabled()).toBe(true);
  });

  it('URL ?newNav=0 forces OFF even when localStorage says on', () => {
    window.localStorage.setItem(NEW_NAV_FLAG_KEY, '1');
    setSearch('?newNav=0');
    expect(isNewNavEnabled()).toBe(false);
  });

  it('useNewNav() reflects the flag at mount', () => {
    setSearch('?newNav=1');
    const { result } = renderHook(() => useNewNav());
    expect(result.current).toBe(true);
  });

  it('useNewNav() is OFF by default', () => {
    const { result } = renderHook(() => useNewNav());
    expect(result.current).toBe(false);
  });
});
