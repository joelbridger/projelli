import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EV_OPEN_EMAIL } from '@/config/identity';
import { useCitationHandlers } from './useCitationHandlers';

describe('useCitationHandlers registered source routing', () => {
  it('keeps mail on the reading-view event route', () => {
    const opened = vi.fn();
    const openFile = vi.fn();
    window.addEventListener(EV_OPEN_EMAIL, opened);
    try {
      const { result } = renderHook(() =>
        useCitationHandlers({
          setMissingSourceWarning: vi.fn(),
          onOpenFileAtPath: openFile,
        }),
      );
      act(() => {
        result.current.handleCitationClick(
          'message-1',
          0,
          'mail',
          undefined,
          'Email excerpt',
        );
      });
      expect(opened).toHaveBeenCalledOnce();
      expect((opened.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
        sourceId: 'message-1',
      });
      expect(openFile).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(EV_OPEN_EMAIL, opened);
    }
  });

  it('keeps PDF page and CRM fallback arguments on the host opener', () => {
    const openFile = vi.fn();
    const { result } = renderHook(() =>
      useCitationHandlers({
        setMissingSourceWarning: vi.fn(),
        onOpenFileAtPath: openFile,
      }),
    );
    act(() => {
      result.current.handleCitationClick('plan.pdf', 12, 'pdf', 7, 'Quote');
      result.current.handleCitationClick(
        'crm:note:1',
        3,
        'crm',
        undefined,
        'Private note',
      );
    });
    expect(openFile).toHaveBeenNthCalledWith(1, 'plan.pdf', 7);
    expect(openFile).toHaveBeenNthCalledWith(
      2,
      'crm:note:1',
      3,
      'Private note',
    );
  });
});
