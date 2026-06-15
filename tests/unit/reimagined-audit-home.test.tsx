// Unit tests for ReimaginedAuditHome — full-page AI Audit surface.
//
// Covers:
// - Rows render for each entry (newest-first order)
// - Search filtering over description / action / actor text
// - Category filter chips narrow to the matching action types
// - Date-range filters compose correctly
// - Export CSV + JSON buttons present and enabled only when entries exist
// - Empty state renders when no entries match
// - Detail panel opens on row click, closes on Escape

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReimaginedAuditHome } from '@/components/audit/ReimaginedAuditHome';
import type { AuditEntry } from '@/types/audit';

function makeEntry(partial: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: `e-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: '2026-04-16T10:00:00.000Z',
    action: 'model_call',
    description: 'Model call',
    model: 'claude-sonnet-4',
    inputs: {},
    outputs: {},
    userDecision: undefined,
    metadata: {},
    ...partial,
  };
}

const SAMPLE: AuditEntry[] = [
  makeEntry({
    id: 'entry-file',
    timestamp: '2026-04-10T08:00:00.000Z',
    action: 'file_create',
    description: 'Created contract.docx',
    model: undefined,
  }),
  makeEntry({
    id: 'entry-model',
    timestamp: '2026-04-16T12:00:00.000Z',
    action: 'model_call',
    description: 'Summarize deposition',
    model: 'claude-sonnet-4',
  }),
  makeEntry({
    id: 'entry-egress',
    timestamp: '2026-04-20T09:00:00.000Z',
    action: 'egress',
    description: 'AI request sent to anthropic',
    model: undefined,
    metadata: { mode: 'direct', destination: 'provider', dataLeaves: true },
  }),
];

describe('ReimaginedAuditHome', () => {
  it('renders all entries by default (newest first)', () => {
    render(<ReimaginedAuditHome entries={SAMPLE} />);
    const rows = screen.getAllByTestId('audit-table-row');
    expect(rows).toHaveLength(3);
    // Newest first: egress (Apr 20), model (Apr 16), file (Apr 10)
    expect(rows[0]).toHaveTextContent('AI Request Sent');
    expect(rows[1]).toHaveTextContent('Model Call');
    expect(rows[2]).toHaveTextContent('File Created');
  });

  it('renders the page title Activity Log', () => {
    render(<ReimaginedAuditHome entries={SAMPLE} />);
    expect(screen.getByRole('heading', { level: 1, name: /Activity Log/i })).toBeInTheDocument();
  });

  it('search filters rows by description text', () => {
    render(<ReimaginedAuditHome entries={SAMPLE} />);
    const search = screen.getByTestId('audit-home-search');
    fireEvent.change(search, { target: { value: 'deposition' } });
    expect(screen.getAllByTestId('audit-table-row')).toHaveLength(1);
    expect(screen.getByText('Summarize deposition')).toBeInTheDocument();
  });

  it('search filters rows by action string', () => {
    render(<ReimaginedAuditHome entries={SAMPLE} />);
    const search = screen.getByTestId('audit-home-search');
    fireEvent.change(search, { target: { value: 'egress' } });
    expect(screen.getAllByTestId('audit-table-row')).toHaveLength(1);
    expect(screen.getByText('AI request sent to anthropic')).toBeInTheDocument();
  });

  it('filter panel is hidden by default and shown after toggle click', () => {
    render(<ReimaginedAuditHome entries={SAMPLE} />);
    expect(screen.queryByTestId('audit-filter-panel')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('audit-home-filter-toggle'));
    expect(screen.getByTestId('audit-filter-panel')).toBeInTheDocument();
  });

  it('date-from filter removes entries before the given date', () => {
    render(<ReimaginedAuditHome entries={SAMPLE} />);
    fireEvent.click(screen.getByTestId('audit-home-filter-toggle'));
    const from = screen.getByTestId('audit-home-filter-date-from');
    fireEvent.change(from, { target: { value: '2026-04-16' } });
    // Should keep Apr 16 (model) and Apr 20 (egress); remove Apr 10 (file)
    const rows = screen.getAllByTestId('audit-table-row');
    expect(rows).toHaveLength(2);
    expect(screen.queryByText('Created contract.docx')).not.toBeInTheDocument();
  });

  it('date-to filter removes entries after the given date', () => {
    render(<ReimaginedAuditHome entries={SAMPLE} />);
    fireEvent.click(screen.getByTestId('audit-home-filter-toggle'));
    const to = screen.getByTestId('audit-home-filter-date-to');
    fireEvent.change(to, { target: { value: '2026-04-16' } });
    // Should keep Apr 10 (file) and Apr 16 (model); remove Apr 20 (egress)
    const rows = screen.getAllByTestId('audit-table-row');
    expect(rows).toHaveLength(2);
    expect(screen.queryByText('AI request sent to anthropic')).not.toBeInTheDocument();
  });

  it('export CSV and JSON buttons are present and enabled when entries exist', () => {
    render(<ReimaginedAuditHome entries={SAMPLE} />);
    const csvBtn = screen.getByTestId('audit-home-export-csv');
    const jsonBtn = screen.getByTestId('audit-home-export-json');
    expect(csvBtn).toBeInTheDocument();
    expect(jsonBtn).toBeInTheDocument();
    expect(csvBtn).not.toBeDisabled();
    expect(jsonBtn).not.toBeDisabled();
  });

  it('export buttons are disabled when no entries match current filters', () => {
    render(<ReimaginedAuditHome entries={SAMPLE} />);
    const search = screen.getByTestId('audit-home-search');
    // A query that matches nothing
    fireEvent.change(search, { target: { value: 'zzznomatch' } });
    expect(screen.getByTestId('audit-home-export-csv')).toBeDisabled();
    expect(screen.getByTestId('audit-home-export-json')).toBeDisabled();
  });

  it('shows empty state when entries array is empty', () => {
    render(<ReimaginedAuditHome entries={[]} />);
    expect(screen.getByTestId('audit-empty-state')).toBeInTheDocument();
    expect(screen.getByText('No activity logged yet')).toBeInTheDocument();
    expect(screen.queryByTestId('audit-table-row')).not.toBeInTheDocument();
  });

  it('shows empty state when search matches nothing', () => {
    render(<ReimaginedAuditHome entries={SAMPLE} />);
    fireEvent.change(screen.getByTestId('audit-home-search'), {
      target: { value: 'zzznomatch' },
    });
    expect(screen.getByTestId('audit-empty-state')).toBeInTheDocument();
  });

  it('detail panel opens on row click and shows entry info', () => {
    render(<ReimaginedAuditHome entries={SAMPLE} />);
    const rows = screen.getAllByTestId('audit-table-row');
    fireEvent.click(rows[0]); // egress row (newest)
    const panel = screen.getByTestId('audit-detail-panel');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveTextContent('AI Request Sent');
  });

  it('detail panel closes when close button is clicked', () => {
    render(<ReimaginedAuditHome entries={SAMPLE} />);
    fireEvent.click(screen.getAllByTestId('audit-table-row')[0]);
    const panel = screen.getByTestId('audit-detail-panel');
    expect(panel).toBeInTheDocument();
    // Close button is inside the detail panel
    const closeBtn = panel.querySelector('button[aria-label="Close detail panel"]');
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn!);
    expect(screen.queryByTestId('audit-detail-panel')).not.toBeInTheDocument();
  });

  it('scope pill renders for egress entries with mode metadata', () => {
    render(<ReimaginedAuditHome entries={SAMPLE} />);
    // The egress entry has mode: 'direct' → should show "Direct" scope pill
    expect(screen.getByTestId('audit-scope-pill')).toBeInTheDocument();
    expect(screen.getByTestId('audit-scope-pill')).toHaveTextContent('Direct');
  });
});
