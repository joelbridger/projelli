import '@/i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ClientMapPanel } from './ClientMapPanel';
import type { ClientMap } from '@/platform/clientMap/types';

function makeMap(): ClientMap {
  return {
    matterId: 'matter-1',
    sections: [
      {
        id: 'household',
        kind: 'core',
        key: 'household',
        title: 'Household',
        items: [
          {
            id: 'fact-1',
            text: 'Sarah is the primary contact.',
            origin: 'ai',
            isAssumption: false,
            sources: [
              {
                kind: 'document',
                ref: 'clients/sarah/profile.docx',
                snippet: 'Sarah Henderson is the primary contact.',
              },
            ],
            updatedAt: '2026-07-08T00:00:00Z',
          },
        ],
      },
    ],
    completeness: {
      level: 'getting-there',
      know: [],
      assuming: [],
      ask: [{ text: 'Confirm Sarah’s preferred contact method.', sectionKey: 'household' }],
    },
    pendingUpdates: [],
    lastBuiltAt: '2026-07-08T00:00:00Z',
    lastSourceFingerprint: 'fp-1',
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('ClientMapPanel simplified controls', () => {
  it('starts Sources collapsed and opens it from a source chip', () => {
    const openSource = vi.fn();

    render(
      <ClientMapPanel
        map={makeMap()}
        onOpenSource={openSource}
        onEditItem={() => {}}
      />,
    );

    expect(screen.getByTestId('clientmap-sources-pane').getAttribute('data-collapsed')).toBe('true');

    fireEvent.click(screen.getByTestId('clientmap-source-link'));

    expect(screen.getByTestId('clientmap-sources-pane').getAttribute('data-collapsed')).toBe('false');
    expect(screen.getByTestId('source-card')).toBeTruthy();
    expect(openSource).not.toHaveBeenCalled();
  });

  it('puts fact edit and remove actions inside a row menu', async () => {
    render(
      <ClientMapPanel
        map={makeMap()}
        onOpenSource={() => {}}
        onEditItem={() => {}}
      />,
    );

    expect(screen.queryByTestId('clientmap-item-edit')).toBeNull();
    expect(screen.queryByTestId('clientmap-item-remove')).toBeNull();

    fireEvent.pointerDown(screen.getByTestId('clientmap-item-menu'), {
      button: 0,
      ctrlKey: false,
    });

    expect((await screen.findByTestId('clientmap-item-edit')).textContent).toBe('Edit');
    expect(screen.getByTestId('clientmap-item-remove').textContent).toBe('Remove');
  });

  it('keeps Add fact collapsed until the row is opened', () => {
    render(
      <ClientMapPanel
        map={makeMap()}
        onOpenSource={() => {}}
        onEditItem={() => {}}
      />,
    );

    expect(screen.queryByTestId('clientmap-add-bullet-input')).toBeNull();

    fireEvent.click(screen.getByTestId('clientmap-add-fact-row'));

    expect(screen.getByTestId('clientmap-add-bullet-input').getAttribute('placeholder')).toBe('Add fact');
    expect(within(screen.getByTestId('clientmap-add-bullet-form')).getByText('Add')).toBeTruthy();
  });
});
