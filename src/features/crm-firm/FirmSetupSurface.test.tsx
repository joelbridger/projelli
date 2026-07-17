import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { FirmSetup } from './FirmSetup';

const save = vi.fn().mockResolvedValue(undefined);
let records: LiveCrmRecord[] = [];

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({ records, save, error: null }),
}));

describe('FirmSetupSurface', () => {
  it('does not offer a firm administration button that has no visible destination', () => {
    records = [];
    render(<FirmSetup />);
    expect(screen.queryByTestId('crm-firm-open-admin')).not.toBeInTheDocument();
  });

  it('starts honestly empty and keeps access authority in firm administration', () => {
    records = [];
    render(<FirmSetup />);
    expect(screen.getByTestId('crm-firm-directory-empty')).toBeInTheDocument();
    expect(screen.getByTestId('crm-firm-access-read-model')).toHaveTextContent(/only place to invite people/i);
    expect(screen.getByTestId('crm-firm-visibility-read-model')).toHaveTextContent(/cannot create a group/i);
    expect(screen.getByTestId('crm-firm-permissions-read-model')).toHaveTextContent(/one source of truth/i);
    expect(screen.queryByTestId('crm-firm-member-role-save')).not.toBeInTheDocument();
    expect(screen.getByTestId('crm-ethical-wall-notice')).toHaveTextContent(/encryption key/i);
    expect(screen.queryByText('Maya Patel')).not.toBeInTheDocument();
  });

  it('shows roles and teams from the firm-admin directory without creating access records', () => {
    records = [{ id: 'directory-1', kind: 'firmDirectoryEntry', matterId: 'firm_home', userId: 'maya', displayName: 'Maya Patel', title: 'Owner', teamLabels: ['Client service'], active: true }];
    render(<FirmSetup />);
    expect(screen.getByTestId('crm-firm-directory')).toHaveTextContent('Maya Patel');
    expect(screen.getByTestId('crm-firm-directory')).toHaveTextContent('Owner');
    expect(screen.getByTestId('crm-firm-directory')).toHaveTextContent('Client service');
    expect(screen.getByTestId('crm-firm-role-directory-1')).toHaveTextContent('Owner');
    expect(screen.getByTestId('crm-firm-team-directory-1')).toHaveTextContent('Client service');
    expect(screen.queryByTestId('crm-firm-team-save')).not.toBeInTheDocument();
  });

  it('saves a firm custom-field definition with its real record contract', async () => {
    records = [];
    save.mockClear();
    render(<FirmSetup initialTab="fields" />);
    fireEvent.click(screen.getByTestId('crm-field-create'));
    fireEvent.change(screen.getByTestId('crm-field-label'), { target: { value: 'Service region' } });
    fireEvent.change(screen.getByTestId('crm-field-key'), { target: { value: 'service-region' } });
    fireEvent.change(screen.getByTestId('crm-field-type'), { target: { value: 'enum' } });
    fireEvent.change(screen.getByTestId('crm-field-options'), { target: { value: 'North, South' } });
    fireEvent.click(screen.getByTestId('crm-field-save'));
    await Promise.resolve();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'customFieldDef', matterId: 'firm_home', key: 'service_region', label: 'Service region', fieldType: 'enum', options: ['North', 'South'],
    }));
  });

  it('saves tags and applies a selected tag plus a dated field value to a real record', async () => {
    records = [
      { id: 'field-1', kind: 'customFieldDef', matterId: 'firm_home', key: 'region', label: 'Region', fieldType: 'text', appliesTo: ['household'], required: false, order: 1, archived: false, deleted: false },
      { id: 'tag-1', kind: 'tag', matterId: 'firm_home', name: 'New client', color: '#2563eb', deleted: false },
      { id: 'household-1', kind: 'household', matterId: 'matter-1', name: 'Smith household', tagIds: [] },
    ];
    save.mockClear();
    render(<FirmSetup initialTab="values" />);
    fireEvent.change(screen.getByTestId('crm-record-values-select'), { target: { value: 'household-1' } });
    fireEvent.change(screen.getByTestId('crm-record-value-region'), { target: { value: 'North' } });
    fireEvent.click(screen.getByTestId('crm-record-tag-tag-1'));
    fireEvent.click(screen.getByTestId('crm-record-values-save'));
    await Promise.resolve();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      id: 'household-1', tagIds: ['tag-1'], tags: ['New client'], customFields: expect.objectContaining({ region: expect.objectContaining({ value: 'North', updatedAt: expect.any(String) }) }),
    }));
  });

  it('keeps unsaved details through a same-record live refresh, but resets for another record', async () => {
    records = [
      { id: 'field-1', kind: 'customFieldDef', matterId: 'firm_home', key: 'region', label: 'Region', fieldType: 'text', appliesTo: ['household'], required: false, order: 1, archived: false, deleted: false },
      { id: 'household-1', kind: 'household', matterId: 'matter-1', name: 'Smith household', updatedAt: '2026-07-17T00:00:00.000Z', customFields: { region: { value: 'Saved North' } } },
      { id: 'household-2', kind: 'household', matterId: 'matter-2', name: 'Jones household', updatedAt: '2026-07-17T00:00:00.000Z', customFields: { region: { value: 'Saved South' } } },
    ];
    const view = render(<FirmSetup initialTab="values" />);
    fireEvent.change(screen.getByTestId('crm-record-values-select'), { target: { value: 'household-1' } });
    await waitFor(() => { expect(screen.getByTestId('crm-record-value-region')).toHaveValue('Saved North'); });
    fireEvent.change(screen.getByTestId('crm-record-value-region'), { target: { value: 'Advisor typed' } });
    records = records.map((record) => record.id === 'household-1'
      ? { ...record, updatedAt: '2026-07-17T00:01:00.000Z', customFields: { region: { value: 'Late refresh' } } }
      : record);
    view.rerender(<FirmSetup initialTab="values" />);
    await waitFor(() => { expect(screen.getByTestId('crm-record-value-region')).toHaveValue('Advisor typed'); });
    fireEvent.change(screen.getByTestId('crm-record-values-select'), { target: { value: 'household-2' } });
    await waitFor(() => { expect(screen.getByTestId('crm-record-value-region')).toHaveValue('Saved South'); });
  });
});
