/**
 * F2.7a — handleOpenBrowserTab must never throw on a malformed URL.
 *
 * The normal path (useAppCommands.ts's "Open Browser Tab" command) always
 * normalizes/validates before calling this, but the hostname lookup here
 * stays defensive in case of a future caller that skips that step.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTabOpening } from '@/app/lifecycle/useTabOpening';

function renderTabOpening(openTab = vi.fn()) {
  const utils = renderHook(() =>
    useTabOpening({
      openTab,
      setSidebarActiveTab: vi.fn(),
      setDocumentsView: vi.fn(),
    })
  );
  return { ...utils, openTab };
}

describe('useTabOpening — handleOpenBrowserTab', () => {
  it('derives the tab title from a valid absolute URL', () => {
    const { result, openTab } = renderTabOpening();

    act(() => {
      result.current.handleOpenBrowserTab('https://example.com/path');
    });

    expect(openTab).toHaveBeenCalledTimes(1);
    const [, tabName, , type, metadata] = openTab.mock.calls[0];
    expect(tabName).toBe('example.com');
    expect(type).toBe('browser');
    expect(metadata).toEqual({ url: 'https://example.com/path' });
  });

  it('falls back to the raw string instead of throwing on a malformed URL', () => {
    const { result, openTab } = renderTabOpening();

    expect(() => {
      act(() => {
        result.current.handleOpenBrowserTab('not a url');
      });
    }).not.toThrow();

    expect(openTab).toHaveBeenCalledTimes(1);
    const [, tabName] = openTab.mock.calls[0];
    expect(tabName).toBe('not a url');
  });

  it('prefers an explicit title over the derived hostname', () => {
    const { result, openTab } = renderTabOpening();

    act(() => {
      result.current.handleOpenBrowserTab('https://example.com', 'My Tab');
    });

    const [, tabName] = openTab.mock.calls[0];
    expect(tabName).toBe('My Tab');
  });
});
