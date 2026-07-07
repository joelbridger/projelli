import '@/i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClientMapPanel } from '@/features/matters/ClientMapPanel';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';
import type { ClientMap } from '@/platform/clientMap/types';
import { skClientMapTab } from '@/config/identity';

/**
 * Client Map opening behavior: the owner wants every fresh open to land on the
 * first core section, even when the map has open gaps. The "What I'm missing"
 * tab stays reachable in the rail, but it no longer steals first focus.
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

  it('lands on Household on a fresh open even when the client has unresolved gaps', () => {
    const map = gapMap();
    render(<ClientMapPanel map={map} onOpenSource={vi.fn()} onEditItem={vi.fn()} />);

    expect(screen.getByTestId('clientmap-tab-household')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Client: Jennifer Caldwell, 58.')).toBeInTheDocument();
    expect(screen.queryByTestId('clientmap-ask-flag')).toBeNull();
  });

  it('honors a remembered tab preference on revisit', () => {
    const map = gapMap();
    localStorage.setItem(skClientMapTab(map.matterId), 'money');
    render(<ClientMapPanel map={map} onOpenSource={vi.fn()} onEditItem={vi.fn()} />);

    expect(screen.getByTestId('clientmap-tab-money')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('clientmap-tab-household')).toHaveAttribute('aria-selected', 'false');
  });
});
