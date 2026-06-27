import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClientMapPanel } from '@/features/matters/ClientMapPanel';
import { emptyClientMap, CORE_SECTION_TITLE } from '@/platform/clientMap/types';
import type { ClientMap } from '@/platform/clientMap/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/** A demo map with a couple of facts so the index rail + reading pane have content. */
function demoMap(): ClientMap {
  const base = emptyClientMap('matter_demo_x');
  const standing = base.sections.find((s) => s.id === 'standing');
  if (standing) {
    standing.items = [
      { id: 'i1', text: 'Investable assets $4.2M; 62/38 split.', origin: 'ai', isAssumption: false, sources: [], updatedAt: '2026-06-20T00:00:00.000Z' },
    ];
  }
  return base;
}

describe('ClientMapPanel (newNav hero view)', () => {
  it('renders the redesigned panel without crashing on a seeded map', () => {
    const { container } = render(
      <ClientMapPanel map={demoMap()} onOpenSource={vi.fn()} onEditItem={vi.fn()} />,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it('shows the core section titles as index-rail tabs', () => {
    render(<ClientMapPanel map={demoMap()} onOpenSource={vi.fn()} onEditItem={vi.fn()} />);
    // "Standing" (or whatever the configured title is) should appear in the rail.
    expect(screen.getAllByText(CORE_SECTION_TITLE.standing).length).toBeGreaterThan(0);
  });

  it('renders a fact from the selected section in the reading pane', () => {
    render(<ClientMapPanel map={demoMap()} onOpenSource={vi.fn()} onEditItem={vi.fn()} />);
    // The standing fact should be reachable (it is the first section with content,
    // which the panel auto-selects).
    const standingTab = screen.getAllByText(CORE_SECTION_TITLE.standing)[0];
    fireEvent.click(standingTab);
    expect(screen.getByText(/Investable assets \$4\.2M/)).toBeTruthy();
  });
});
