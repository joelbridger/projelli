import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CrmHome } from './CrmHome';

describe('CrmHome', () => {
  it('opens Home on Today and moves to the task board', () => {
    render(<CrmHome />);
    expect(screen.getByTestId('crm-screen-today')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('crm-home-nav-tasks'));
    fireEvent.click(screen.getByTestId('crm-task-board-view'));
    expect(screen.getByTestId('crm-task-board')).toBeInTheDocument();
  });

  it('saves a direct local task edit from the detail panel', () => {
    const updateTask = vi.fn();
    render(<CrmHome adapter={{ freshness: { kind: 'live' }, tasks: [{ id: 't1', title: 'Call client', assigneeUserId: 'maya', assigneeLabel: 'Maya', status: 'open', priority: 'normal' }], offers: [], actions: { updateTask } }} initialRoute="tasks" />);
    fireEvent.click(screen.getByTestId('crm-task-open-t1'));
    fireEvent.change(screen.getByTestId('crm-task-title-input'), { target: { value: 'Call client today' } });
    fireEvent.click(screen.getByTestId('crm-task-save'));
    expect(updateTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Call client today' }));
  });

  it('keeps propagation decisions per instance and blocks bulk approval offline', () => {
    const applyPropagation = vi.fn();
    render(<CrmHome adapter={{ freshness: { kind: 'offline' }, tasks: [], offers: [{ id: 'offer-1', householdLabel: 'Henderson household', revisionLabel: 'Named update', state: 'ready', fields: [{ id: 'field-1', label: 'Due offset', after: '+4 days', accepted: true }] }], actions: { applyPropagation } }} initialRoute="propagation" />);
    expect(screen.getByTestId('crm-propagation-approve-all')).toBeDisabled();
    fireEvent.click(screen.getByTestId('crm-propagation-toggle-field-1'));
    expect(screen.getByTestId('crm-propagation-toggle-field-1')).not.toBeChecked();
    expect(screen.getByText(/read-only offline/i)).toBeInTheDocument();
  });

  it('reports cells that a conditional propagation undo must protect', () => {
    render(<CrmHome adapter={{ freshness: { kind: 'live' }, tasks: [], offers: [], actions: { undoPropagation: () => ({ restored: 2, protectedCells: ['Henderson due offset — later local edit'] }) } }} initialRoute="propagation" />);
    fireEvent.click(screen.getByTestId('crm-propagation-undo'));
    expect(screen.getByTestId('crm-propagation-undo-report')).toHaveTextContent(/protected cells kept/i);
    expect(screen.getByTestId('crm-propagation-undo-report')).toHaveTextContent(/later local edit/i);
  });

  it('keeps both migration fallbacks visible and records local notification read state', () => {
    render(<CrmHome initialRoute="migration" />);
    expect(screen.getByTestId('crm-migration-workflow-fallback')).toBeInTheDocument();
    expect(screen.getByTestId('crm-migration-attachment-fallback')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('crm-notifications-button'));
    fireEvent.click(screen.getByTestId('crm-notifications-read'));
    expect(screen.getByText(/marked read on this device/i)).toBeInTheDocument();
  });
});
