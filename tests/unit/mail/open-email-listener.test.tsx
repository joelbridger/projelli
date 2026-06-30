/**
 * WS-B/C — the `lantern:open-email` listener.
 *
 * Clicking an email citation in chat dispatches a `lantern:open-email` window
 * event; `useOpenEmailListener` must open an `email` tab for that exact message,
 * carrying the source id in `metadata.mailSourceId` so the viewer can fetch it.
 *
 * This is the renderer half of the end-to-end citation -> open path
 * (AIChatViewer.handleCitationClick dispatches the event; App mounts this hook;
 * the hook opens the EmailViewer tab via the editor store's openTab).
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useOpenEmailListener,
  mailIdFromSource,
  emailTabLabel,
} from '@/platform/hooks/useOpenEmailListener';

function dispatchOpenEmail(sourceId: unknown) {
  window.dispatchEvent(
    new CustomEvent('lantern:open-email', { detail: { sourceId } }),
  );
}

describe('useOpenEmailListener', () => {
  it('opens an email tab for the dispatched mail source id', () => {
    const openTab = vi.fn();
    renderHook(() => useOpenEmailListener(openTab));

    dispatchOpenEmail('mail:AAMk-xyz');

    expect(openTab).toHaveBeenCalledTimes(1);
    const [path, , content, type, metadata] = openTab.mock.calls[0]!;
    // The tab is keyed by the full source id so re-clicking focuses (dedups) it.
    expect(path).toBe('mail:AAMk-xyz');
    expect(content).toBe('');
    expect(type).toBe('email');
    expect(metadata).toEqual({ mailSourceId: 'mail:AAMk-xyz' });
  });

  it('opens the correct id when two different emails are cited', () => {
    const openTab = vi.fn();
    renderHook(() => useOpenEmailListener(openTab));

    dispatchOpenEmail('mail:first');
    dispatchOpenEmail('mail:second');

    expect(openTab).toHaveBeenCalledTimes(2);
    expect(openTab.mock.calls[0]![0]).toBe('mail:first');
    expect(openTab.mock.calls[1]![0]).toBe('mail:second');
    expect(openTab.mock.calls[1]![4]).toEqual({ mailSourceId: 'mail:second' });
  });

  it('ignores an event with no source id', () => {
    const openTab = vi.fn();
    renderHook(() => useOpenEmailListener(openTab));
    dispatchOpenEmail(undefined);
    expect(openTab).not.toHaveBeenCalled();
  });

  it('removes the listener on unmount (no leak / no late opens)', () => {
    const openTab = vi.fn();
    const { unmount } = renderHook(() => useOpenEmailListener(openTab));
    unmount();
    dispatchOpenEmail('mail:after-unmount');
    expect(openTab).not.toHaveBeenCalled();
  });

  it('derives the message id and a short tab label from the source', () => {
    expect(mailIdFromSource('mail:AAMk-abc')).toBe('AAMk-abc');
    expect(mailIdFromSource('AAMk-abc')).toBe('AAMk-abc');
    expect(emailTabLabel('mail:AAMk-abcdefgh')).toBe('Email AAMk-abc');
  });
});
