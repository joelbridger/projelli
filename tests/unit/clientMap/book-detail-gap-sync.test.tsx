import '@/i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClientMapPanel } from '@/features/matters/ClientMapPanel';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';
import type { ClientMap } from '@/platform/clientMap/types';
import { skClientMapTab } from '@/config/identity';

/**
 * Regression for the Wave-4 bench finding: when a client has an
 * estate/beneficiary gap, opening that client's Client Map sub-tab must show
 * the resolvable gap control (clientmap-ask-flag) without an extra,
 * undiscoverable click into the "What I'm missing" tab.
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('Client detail gap surfacing', () => {
  beforeEach(() => {
    useClientMapStore.setState({ maps: {} });
    localStorage.clear();
  });

  it('the client\'s Client Map panel immediately surfaces a resolvable gap control (no extra tab click)', () => {
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
