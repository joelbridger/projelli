import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { FirmSetupSurface } from './FirmSetupSurface';

const save = vi.fn().mockResolvedValue(undefined);
let records: Record<string, unknown>[] = [];

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({ records, save, error: null }),
}));

describe('FirmSetupSurface', () => {
  it('starts honestly empty and explains that access is controlled through firm administration', () => {
    records = [];
    render(<FirmSetupSurface />);
    expect(screen.getByTestId('crm-firm-directory-empty')).toBeInTheDocument();
    expect(screen.getByTestId('crm-ethical-wall-notice')).toHaveTextContent(/encryption key/i);
    expect(screen.queryByText('Maya Patel')).not.toBeInTheDocument();
  });

  it('saves a firm custom-field definition with its real record contract', async () => {
    records = [];
    save.mockClear();
    render(<FirmSetupSurface initialTab="fields" />);
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
    render(<FirmSetupSurface initialTab="values" />);
    fireEvent.change(screen.getByTestId('crm-record-values-select'), { target: { value: 'household-1' } });
    fireEvent.change(screen.getByTestId('crm-record-value-region'), { target: { value: 'North' } });
    fireEvent.click(screen.getByTestId('crm-record-tag-tag-1'));
    fireEvent.click(screen.getByTestId('crm-record-values-save'));
    await Promise.resolve();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      id: 'household-1', tagIds: ['tag-1'], tags: ['New client'], customFields: expect.objectContaining({ region: expect.objectContaining({ value: 'North', updatedAt: expect.any(String) }) }),
    }));
  });
});
