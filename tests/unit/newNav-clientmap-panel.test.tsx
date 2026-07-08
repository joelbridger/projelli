import '@/i18n';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClientMapPanel } from '@/features/matters/ClientMapPanel';
import { emptyClientMap } from '@/platform/clientMap/types';
import { skClientMapSourcesCollapsed } from '@/config/identity';
import type { ClientMap, SourceRef } from '@/platform/clientMap/types';

/** A demo map with a couple of facts so the index rail + reading pane have content. */
function demoMap(): ClientMap {
  const base = emptyClientMap('matter_demo_x');
  const money = base.sections.find((s) => s.id === 'money')!;
  money.items = [
    { id: 'i1', text: 'Investable assets $4.2M; 62/38 split.', origin: 'ai', isAssumption: false, sources: [], updatedAt: '2026-06-20T00:00:00.000Z' },
  ];
  return base;
}

function mapWithDocumentSources(): ClientMap {
  const base = emptyClientMap('matter_demo_sources');
  const money = base.sections.find((s) => s.id === 'money')!;
  const docxSource: SourceRef = {
    kind: 'document',
    ref: '/clients/hendricks/plan.docx',
    snippet: 'The plan targets retirement at 62.',
    locator: 'paragraph 4',
  };
  const pdfSource: SourceRef = {
    kind: 'document',
    ref: '/clients/hendricks/tax-return.pdf',
    snippet: 'The return shows taxable income.',
    locator: 'page 2',
  };
  money.items = [
    {
      id: 'i-docx',
      text: 'The client wants to retire at 62.',
      origin: 'ai',
      isAssumption: false,
      sources: [docxSource],
      updatedAt: '2026-06-20T00:00:00.000Z',
    },
    {
      id: 'i-pdf',
      text: 'The latest tax return is on file.',
      origin: 'ai',
      isAssumption: false,
      sources: [pdfSource],
      updatedAt: '2026-06-20T00:00:00.000Z',
    },
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
    expect(screen.getByText('Money')).toBeTruthy();
  });

  it('renders a fact from the selected section in the reading pane', () => {
    render(<ClientMapPanel map={demoMap()} onOpenSource={vi.fn()} onEditItem={vi.fn()} />);
    // The money fact should be reachable (it is the first section with content,
    // which the panel auto-selects).
    fireEvent.click(screen.getByTestId('clientmap-tab-money'));
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
    fireEvent.click(screen.getByTestId('clientmap-source-link'));
    fireEvent.click(screen.getByTestId('source-card'));
    expect(onOpenSource).toHaveBeenCalledWith(crmSource);
  });

  it('puts the compact add action before the section tabs', () => {
    render(
      <ClientMapPanel
        map={demoMap()}
        onOpenSource={vi.fn()}
        onEditItem={vi.fn()}
      />,
    );

    const addButton = screen.getByTestId('clientmap-tab-add');
    const householdTab = screen.getByTestId('clientmap-tab-household');

    expect(addButton).toHaveAccessibleName('New section');
    expect(addButton).toHaveTextContent('');
    expect(addButton.compareDocumentPosition(householdTab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByTestId('clientmap-start-interview')).toBeNull();

    fireEvent.click(addButton);
    expect(screen.getByTestId('custom-section-title')).toBeInTheDocument();
  });

  it('keeps an accessible label for the compact add action', () => {
    render(
      <ClientMapPanel
        map={demoMap()}
        onOpenSource={vi.fn()}
        onEditItem={vi.fn()}
      />,
    );

    const addButton = screen.getByTestId('clientmap-tab-add');
    expect(addButton).toHaveAccessibleName('New section');
    expect(addButton).toHaveAttribute('title', 'New section');
  });

  it('uses document-type colors in the sources pane', () => {
    render(<ClientMapPanel map={mapWithDocumentSources()} onOpenSource={vi.fn()} onEditItem={vi.fn()} />);

    fireEvent.click(screen.getByTestId('clientmap-tab-money'));
    fireEvent.click(screen.getAllByTestId('clientmap-source-link')[0]!);

    const icons = screen.getAllByTestId('source-card-file-icon');
    expect(icons[0]).toHaveClass('text-blue-500');
    expect(icons[1]).toHaveClass('text-red-500');
  });

  it('collapses and restores the sources pane, and remembers the choice', () => {
    const map = mapWithDocumentSources();
    render(<ClientMapPanel map={map} onOpenSource={vi.fn()} onEditItem={vi.fn()} />);

    const pane = screen.getByTestId('clientmap-sources-pane');
    const toggle = screen.getByTestId('clientmap-sources-toggle');
    expect(pane.dataset['collapsed']).toBe('true');
    expect(localStorage.getItem(skClientMapSourcesCollapsed(map.matterId))).toBeNull();

    fireEvent.click(toggle);

    expect(screen.getByTestId('clientmap-sources-pane').dataset['collapsed']).toBe('false');
    expect(localStorage.getItem(skClientMapSourcesCollapsed(map.matterId))).toBe('0');
    expect(screen.getByTestId('source-panel')).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.getByTestId('clientmap-sources-pane').dataset['collapsed']).toBe('true');
    expect(localStorage.getItem(skClientMapSourcesCollapsed(map.matterId))).toBe('1');
  });

  it('starts with the sources pane collapsed when the saved preference says so', () => {
    const map = mapWithDocumentSources();
    localStorage.setItem(skClientMapSourcesCollapsed(map.matterId), '1');

    render(<ClientMapPanel map={map} onOpenSource={vi.fn()} onEditItem={vi.fn()} />);

    expect(screen.getByTestId('clientmap-sources-pane').dataset['collapsed']).toBe('true');
    fireEvent.click(screen.getByTestId('clientmap-sources-toggle'));
    expect(screen.getByTestId('clientmap-sources-pane').dataset['collapsed']).toBe('false');
    expect(localStorage.getItem(skClientMapSourcesCollapsed(map.matterId))).toBe('0');
  });
});
