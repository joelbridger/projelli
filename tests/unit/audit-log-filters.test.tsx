// Integration tests for AuditLog date-range and model filters (Q6).
//
// We drive the component through React Testing Library, interact with the
// native date inputs and the model <select>, and assert that the rendered
// entry list contracts/expands accordingly. The filter reset button is also
// exercised.

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuditLog } from '@/components/common/AuditLog';
import type { AuditEntry } from '@/types/audit';

function entry(partial: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'e' + Math.random().toString(36).slice(2),
    timestamp: '2026-04-16T10:00:00.000Z',
    action: 'model_call',
    description: 'Entry',
    model: 'claude-sonnet-4',
    inputs: {},
    outputs: {},
    userDecision: undefined,
    metadata: {},
    ...partial,
  };
}

const sample: AuditEntry[] = [
  entry({
    id: 'apr10-claude',
    timestamp: '2026-04-10T12:00:00.000Z',
    description: 'apr10-claude-desc',
    model: 'claude-sonnet-4',
  }),
  entry({
    id: 'apr16-gpt',
    timestamp: '2026-04-16T12:00:00.000Z',
    description: 'apr16-gpt-desc',
    model: 'gpt-4o',
  }),
  entry({
    id: 'apr20-claude',
    timestamp: '2026-04-20T12:00:00.000Z',
    description: 'apr20-claude-desc',
    model: 'claude-sonnet-4',
  }),
];

function openFilters() {
  // The filter toggle button surfaces the filter row.
  fireEvent.click(screen.getByRole('button', { name: /^Filter/i }));
}

describe('AuditLog — Q6 filters', () => {
  it('renders all entries initially with entry count', () => {
    render(<AuditLog entries={sample} />);
    expect(screen.getByText('apr10-claude-desc')).toBeInTheDocument();
    expect(screen.getByText('apr16-gpt-desc')).toBeInTheDocument();
    expect(screen.getByText('apr20-claude-desc')).toBeInTheDocument();
    expect(screen.getByText('(3 entries)')).toBeInTheDocument();
  });

  it('filters to a single day inclusive when dateFrom === dateTo', () => {
    render(<AuditLog entries={sample} />);
    openFilters();

    const from = screen.getByTestId('audit-log-filter-date-from');
    const to = screen.getByTestId('audit-log-filter-date-to');
    fireEvent.change(from, { target: { value: '2026-04-16' } });
    fireEvent.change(to, { target: { value: '2026-04-16' } });

    expect(screen.queryByText('apr10-claude-desc')).not.toBeInTheDocument();
    expect(screen.getByText('apr16-gpt-desc')).toBeInTheDocument();
    expect(screen.queryByText('apr20-claude-desc')).not.toBeInTheDocument();
    expect(screen.getByText('(1 entries)')).toBeInTheDocument();
  });

  it('filters by model dropdown populated from unique models in data', () => {
    render(<AuditLog entries={sample} />);
    openFilters();

    const modelSelect = screen.getByTestId('audit-log-filter-model') as HTMLSelectElement;
    // Should list: All models, claude-sonnet-4, gpt-4o.
    const optionValues = Array.from(modelSelect.options).map((o) => o.value);
    expect(optionValues).toEqual(['', 'claude-sonnet-4', 'gpt-4o']);

    fireEvent.change(modelSelect, { target: { value: 'gpt-4o' } });
    expect(screen.queryByText('apr10-claude-desc')).not.toBeInTheDocument();
    expect(screen.getByText('apr16-gpt-desc')).toBeInTheDocument();
    expect(screen.queryByText('apr20-claude-desc')).not.toBeInTheDocument();
  });

  it('composes date range with model filter', () => {
    render(<AuditLog entries={sample} />);
    openFilters();

    fireEvent.change(screen.getByTestId('audit-log-filter-date-from'), {
      target: { value: '2026-04-15' },
    });
    fireEvent.change(screen.getByTestId('audit-log-filter-model'), {
      target: { value: 'claude-sonnet-4' },
    });

    // apr20-claude matches both filters; apr10 fails date, apr16 fails model.
    expect(screen.queryByText('apr10-claude-desc')).not.toBeInTheDocument();
    expect(screen.queryByText('apr16-gpt-desc')).not.toBeInTheDocument();
    expect(screen.getByText('apr20-claude-desc')).toBeInTheDocument();
  });

  it('reset button clears all filters and is hidden when none are active', () => {
    render(<AuditLog entries={sample} />);
    openFilters();

    // No reset button until a filter is active.
    expect(screen.queryByTestId('audit-log-filter-reset')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('audit-log-filter-date-from'), {
      target: { value: '2026-04-16' },
    });
    fireEvent.change(screen.getByTestId('audit-log-filter-model'), {
      target: { value: 'gpt-4o' },
    });
    expect(screen.getByText('(1 entries)')).toBeInTheDocument();

    const reset = screen.getByTestId('audit-log-filter-reset');
    fireEvent.click(reset);

    // All entries visible again; reset button should be hidden.
    expect(screen.getByText('(3 entries)')).toBeInTheDocument();
    expect(screen.queryByTestId('audit-log-filter-reset')).not.toBeInTheDocument();
  });

  it('active filter count badge reflects the number of independent filters applied', () => {
    render(<AuditLog entries={sample} />);
    // The filter toggle button displays `activeFilterCount` in a badge when > 0.
    openFilters();

    fireEvent.change(screen.getByTestId('audit-log-filter-date-from'), {
      target: { value: '2026-04-10' },
    });
    fireEvent.change(screen.getByTestId('audit-log-filter-date-to'), {
      target: { value: '2026-04-20' },
    });
    fireEvent.change(screen.getByTestId('audit-log-filter-model'), {
      target: { value: 'claude-sonnet-4' },
    });

    // The Filter toggle button now has an accessible name that includes "3".
    const toggle = screen.getByRole('button', { name: /Filter\s*3/i });
    expect(toggle).toBeInTheDocument();
  });
});
