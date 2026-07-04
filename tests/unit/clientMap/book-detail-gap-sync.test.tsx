import '@/i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BookView } from '@/features/matters/book/BookView';
import { ClientMapPanel } from '@/features/matters/ClientMapPanel';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';
import type { ClientMap } from '@/platform/clientMap/types';
import type { Matter } from '@/platform/types/matter';
import { skClientMapTab } from '@/config/identity';

/**
 * Regression for the Wave-4 bench finding: the "Whole book" Client Map view
 * flagged an estate/beneficiary gap chip for a client, but opening that same
 * client's Client Map sub-tab showed no resolvable gap control (no
 * clientmap-ask-flag button) without an extra, undiscoverable click into the
 * "What I'm missing" tab. Book view and client detail must agree on whether a
 * flagged gap is immediately resolvable — same underlying map, same fixture.
 */
function gapMap(): ClientMap {
  const map = emptyClientMap('matter_caldwell_jennifer');
  const household = map.sections.find((s) => s.key === 'household')!;
  // Content in a core section so it wins the OLD "first section with content"
  // default tab — the panel must still surface the gap despite this.
  household.items = [
    { id: 'h1', text: 'Client: Jennifer Caldwell, 58.', origin: 'ai', isAssumption: false, sources: [], updatedAt: '2026-07-01T00:00:00.000Z' },
  ];
  map.lastBuiltAt = '2026-07-01T00:00:00.000Z';
  map.completeness = {
    ...map.completeness,
    ask: [{
      text: 'Beneficiary check: Two documents name different beneficiaries: Alex Caldwell (will) vs. Sam Caldwell (401k form). Flagged for your review. Not legal advice.',
      sectionKey: 'household',
    }],
  };
  return map;
}

function seedBookView(map: ClientMap) {
  const matter = { id: map.matterId, name: 'Caldwell, Jennifer', client: 'Caldwell, Jennifer', folderPaths: ['Clients/Caldwell'], createdAt: '2026-01-01T00:00:00.000Z' } as Matter;
  useMatterStore.setState({ matters: [matter] });
  useClientMapStore.setState({ maps: { [map.matterId]: map } });
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('Book view / client detail gap sync', () => {
  beforeEach(() => {
    useMatterStore.setState({ matters: [] });
    useClientMapStore.setState({ maps: {} });
    localStorage.clear();
  });

  it('book view flags a gap chip for the client', () => {
    const map = gapMap();
    seedBookView(map);
    render(<BookView onOpenClient={() => {}} />);
    expect(screen.getByTestId(`book-row-${map.matterId}`).querySelector('[data-testid="book-gap-chip"]')).toBeTruthy();
  });

  it('the SAME client\'s Client Map panel immediately surfaces a resolvable gap control (no extra tab click)', () => {
    const map = gapMap();
    render(<ClientMapPanel map={map} onOpenSource={vi.fn()} onEditItem={vi.fn()} />);
    // No click into "What I'm missing" — this must be visible on first render,
    // matching what the book view already promised via its gap chip.
    expect(screen.queryByTestId('clientmap-ask-flag')).toBeTruthy();
  });

  it('still surfaces the gap even for a client with a remembered tab preference from a prior visit', () => {
    // Codex review finding: the gap-first fallback only ran when there was no
    // stored tab preference. A client visited before (e.g. an earlier session,
    // or before this gap appeared) has a remembered tab in localStorage that
    // used to take precedence forever, re-burying the gap control on every
    // reopen until resolved.
    const map = gapMap();
    localStorage.setItem(skClientMapTab(map.matterId), 'household');
    render(<ClientMapPanel map={map} onOpenSource={vi.fn()} onEditItem={vi.fn()} />);
    expect(screen.queryByTestId('clientmap-ask-flag')).toBeTruthy();
  });
});
