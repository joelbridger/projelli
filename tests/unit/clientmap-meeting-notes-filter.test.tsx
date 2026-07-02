import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClientMapPanel } from '@/features/matters/ClientMapPanel';
import { emptyClientMap } from '@/platform/clientMap/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// household is the first CORE_SECTION_ORDER entry, so a map whose only
// populated section is household auto-selects into the reading pane.
function demoMap() {
  const map = emptyClientMap('matter_demo_x');
  const household = map.sections.find((s) => s.id === 'household')!;
  household.items = [
    {
      id: 'i-plain',
      text: 'Two children, ages 9 and 12',
      origin: 'ai',
      isAssumption: false,
      sources: [{ kind: 'document', ref: 'Clients/B/Statement.pdf', snippet: 'q' }],
      updatedAt: '2026-06-24T00:00:00Z',
    },
    {
      id: 'i-meeting',
      text: 'Wants to fund a 529 this year',
      origin: 'ai',
      isAssumption: false,
      sources: [{ kind: 'zocks', ref: 'zocks:abc', snippet: 'q' }],
      updatedAt: '2026-06-24T00:00:00Z',
    },
  ];
  return map;
}

describe('Client Map — Imported meeting notes filter', () => {
  it('shows the filter chip and narrows items to those cited to imported meeting notes', () => {
    render(
      <ClientMapPanel
        map={demoMap()}
        onOpenSource={vi.fn()}
        onEditItem={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId('clientmap-item')).toHaveLength(2);
    const chip = screen.getByTestId('clientmap-filter-meeting-notes');
    fireEvent.click(chip);
    const items = screen.getAllByTestId('clientmap-item');
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain('529');
    // Toggle off restores everything.
    fireEvent.click(chip);
    expect(screen.getAllByTestId('clientmap-item')).toHaveLength(2);
  });
});
