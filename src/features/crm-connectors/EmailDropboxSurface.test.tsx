import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EmailDropboxSurface } from './EmailDropboxSurface';

let records: Record<string, unknown>[] = [];
const save = vi.fn();

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({ records, save }),
}));

vi.mock('@/platform/utils/mail-commands', () => ({
  mailCheckDropboxFolder: vi.fn().mockResolvedValue({ items: [] }),
  mailRetagMessageMatter: vi.fn(),
}));

describe('EmailDropboxSurface', () => {
  afterEach(() => {
    cleanup();
    records = [];
  });

  it('keeps an advisor edit through repeated live-record re-seeds', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      records = [
        {
          id: 'email-dropbox-config:current-user',
          kind: 'emailDropboxConfig',
          matterId: 'firm_home',
          folderId: 'Saved folder',
          provider: 'm365',
          account: 'saved@example.test',
          createdAt: '2026-07-17T00:00:00.000Z',
          updatedAt: `2026-07-17T00:00:0${String(attempt)}.000Z`,
        },
      ];
      const view = render(<EmailDropboxSurface />);
      await waitFor(() => {
        expect(screen.getByTestId('crm-email-dropbox-folder')).toHaveValue(
          'Saved folder'
        );
      });
      fireEvent.change(screen.getByTestId('crm-email-dropbox-folder'), {
        target: { value: 'Advisor typed folder' },
      });
      records = [
        {
          ...records[0],
          folderId: 'Late live refresh',
          updatedAt: `2026-07-17T00:01:0${String(attempt)}.000Z`,
        },
      ];
      view.rerender(<EmailDropboxSurface />);
      await waitFor(() => {
        expect(screen.getByTestId('crm-email-dropbox-folder')).toHaveValue(
          'Advisor typed folder'
        );
      });
      view.unmount();
    }
  });
});
