import { beforeEach, describe, it, expect, vi } from 'vitest';
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
  beforeEach(() => {
    localStorage.clear();
  });

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

    fireEvent.click(screen.getByTestId('clientmap-tab-money'));
    fireEvent.click(screen.getByTestId('source-card'));
    expect(onOpenSource).toHaveBeenCalledWith(crmSource);
  });

  it('puts compact icon-only rail actions before the section tabs', () => {
    const onStartInterview = vi.fn();
    render(
      <ClientMapPanel
        map={demoMap()}
        onOpenSource={vi.fn()}
        onEditItem={vi.fn()}
        onStartInterview={onStartInterview}
      />,
    );

    const addButton = screen.getByTestId('clientmap-tab-add');
    const interviewButton = screen.getByTestId('clientmap-start-interview');
    const householdTab = screen.getByTestId('clientmap-tab-household');

    expect(addButton).toHaveAccessibleName('New section');
    expect(interviewButton).toHaveAccessibleName('Start guided interview');
    expect(addButton).toHaveTextContent('');
    expect(interviewButton).toHaveTextContent('');
    expect(addButton.compareDocumentPosition(householdTab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(interviewButton.compareDocumentPosition(householdTab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(addButton);
    expect(screen.getByTestId('custom-section-title')).toBeInTheDocument();

    fireEvent.click(interviewButton);
    expect(onStartInterview).toHaveBeenCalledTimes(1);
  });

  it('shows instant hover tooltips for the compact rail actions', () => {
    render(
      <ClientMapPanel
        map={demoMap()}
        onOpenSource={vi.fn()}
        onEditItem={vi.fn()}
        onStartInterview={vi.fn()}
      />,
    );

    const addButton = screen.getByTestId('clientmap-tab-add');
    fireEvent.mouseEnter(addButton);
    expect(screen.getByRole('tooltip')).toHaveTextContent('New section');
    fireEvent.mouseLeave(addButton);

    const interviewButton = screen.getByTestId('clientmap-start-interview');
    fireEvent.mouseEnter(interviewButton);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Start guided interview');
  });
});
