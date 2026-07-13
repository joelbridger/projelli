import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EV_OPEN_CRM } from '@/config/identity';
import { CitationText } from './CitationText';

describe('CitationText CRM citation', () => {
  it('opens the exact CRM record instead of treating it like a file path', () => {
    const opened = vi.fn();
    window.addEventListener(EV_OPEN_CRM, opened);
    try {
      render(
        <CitationText
          text="The note says this. {1}"
          citations={[{
            n: 1,
            label: 'Internal note',
            excerpt: 'Do not include this in a client draft.',
            path: 'crm:note:note-1',
            locator: 'CRM note',
            verified: true,
            grounded: true,
            sourceType: 'crm',
            matterId: 'household-1',
          }]}
          selected={null}
          onSelect={() => undefined}
        />,
      );

      fireEvent.click(screen.getByTestId('ask-citation-chip-1'));
      expect(opened).toHaveBeenCalledTimes(1);
      // The event MUST carry the full record identity (client + entity kind),
      // not just the id — otherwise the viewer could open a same-id record from
      // another client (Ask-seam defect #2).
      expect((opened.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
        sourceId: 'crm:note:note-1',
        snippet: 'Do not include this in a client draft.',
        matterId: 'household-1',
        entityKind: 'note',
      });
    } finally {
      window.removeEventListener(EV_OPEN_CRM, opened);
    }
  });
});
