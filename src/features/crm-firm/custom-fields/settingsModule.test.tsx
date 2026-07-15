import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { live } = vi.hoisted(() => ({
  live: {
    records: [],
    save: vi.fn(),
    reload: vi.fn(),
    error: null,
  },
}));

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => live,
}));

import { CustomFieldsSettings } from './settingsModule';

describe('CustomFieldsSettings', () => {
  beforeEach(() => {
    live.records = [];
    live.save.mockReset().mockResolvedValue(undefined);
    live.reload.mockReset();
    live.error = null;
  });

  it('defines a choice field from the Organization settings panel', async () => {
    render(<CustomFieldsSettings />);
    expect(await screen.findByTestId('custom-fields-empty')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('custom-fields-open-create'));
    fireEvent.change(screen.getByTestId('custom-fields-name'), {
      target: { value: 'Risk band' },
    });
    fireEvent.change(screen.getByTestId('custom-fields-kind'), {
      target: { value: 'select' },
    });
    fireEvent.change(screen.getByTestId('custom-fields-options'), {
      target: { value: 'Conservative, Balanced' },
    });
    fireEvent.click(screen.getByTestId('custom-fields-create'));
    await waitFor(() => {
      expect(live.save).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'customFieldDef',
          label: 'Risk band',
          fieldType: 'enum',
          options: ['Conservative', 'Balanced'],
          appliesTo: ['household'],
        })
      );
    });
  });
});
