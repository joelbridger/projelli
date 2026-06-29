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
  const money = base.sections.find((s) => s.id === 'money')!;
  money.items = [
    { id: 'i1', text: 'Investable assets $4.2M; 62/38 split.', origin: 'ai', isAssumption: false, sources: [], updatedAt: '2026-06-20T00:00:00.000Z' },
  ];
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
    expect(screen.getAllByText(CORE_SECTION_TITLE.money).length).toBeGreaterThan(0);
  });

  it('renders a fact from the selected section in the reading pane', () => {
    render(<ClientMapPanel map={demoMap()} onOpenSource={vi.fn()} onEditItem={vi.fn()} />);
    // The money fact should be reachable (it is the first section with content,
    // which the panel auto-selects).
    const moneyTab = screen.getAllByText(CORE_SECTION_TITLE.money)[0]!;
    fireEvent.click(moneyTab);
    expect(screen.getByText(/Investable assets \$4\.2M/)).toBeTruthy();
  });

  it('opens a non-document (CRM) Sources-column card through the kind-aware dispatcher (preserves SourceRef.kind)', () => {
    // Regression: the Sources column reuses Ask's SourcePanel, whose AnswerCitation
    // shape keeps only the ref string. A CRM (or OneDrive / e-sign / meeting)
    // source must still open via onOpenSource with its FULL SourceRef — not get
    // dropped or misrouted to the document opener.
    const onOpenSource = vi.fn();
    const map = emptyClientMap('matter_demo_x');
    const money = map.sections.find((s) => s.id === 'money')!;
    const crmSource: import('@/platform/clientMap/types').SourceRef = {
      kind: 'crm', ref: 'crm:household:abc123', snippet: 'AUM $2.1M', locator: '',
    };
    money.items = [
      { id: 'i1', text: 'Investable assets $4.2M.', origin: 'ai', isAssumption: false, sources: [crmSource], updatedAt: '2026-06-20T00:00:00.000Z' },
    ];
    render(<ClientMapPanel map={map} onOpenSource={onOpenSource} onEditItem={vi.fn()} />);

    fireEvent.click(screen.getByTestId('source-card'));
    expect(onOpenSource).toHaveBeenCalledWith(crmSource);
  });
});
