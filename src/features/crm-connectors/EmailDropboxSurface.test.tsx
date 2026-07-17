import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MailListItem } from '@/platform/utils/mail-commands';
import { EmailDropboxSurface } from './EmailDropboxSurface';

const mailMocks = vi.hoisted(() => ({
  checkFolder: vi.fn(),
  retag: vi.fn(),
}));

let records: Record<string, unknown>[] = [];
let workspaceRoot: string | null = '/workspace-a';
let loadError: string | null = null;
const save = vi.fn();

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({
    records,
    save,
    workspaceRoot,
    error: loadError,
  }),
}));

vi.mock('@/platform/utils/mail-commands', () => ({
  mailCheckDropboxFolder: mailMocks.checkFolder,
  mailRetagMessageMatter: mailMocks.retag,
}));

function configRecord(folderId: string, account: string) {
  return {
    id: 'email-dropbox-config:current-user',
    kind: 'emailDropboxConfig',
    matterId: 'firm_home',
    folderId,
    provider: 'm365',
    account,
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:01.000Z',
  };
}

function householdRecord(id: string, name: string) {
  return {
    id,
    kind: 'household',
    matterId: id,
    name,
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:01.000Z',
  };
}

function email(id: string, subject: string, account: string): MailListItem {
  return {
    id,
    subject,
    fromAddr: `${id}@example.test`,
    fromName: id,
    snippet: `${subject} private snippet`,
    receivedDateTime: '2026-07-17T00:00:00.000Z',
    provider: 'm365',
    account,
    folderId: 'Lantern Dropbox',
    hasAttachments: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('EmailDropboxSurface', () => {
  afterEach(() => {
    cleanup();
    records = [];
    workspaceRoot = '/workspace-a';
    loadError = null;
    save.mockReset();
    mailMocks.checkFolder.mockReset();
    mailMocks.retag.mockReset();
  });

  it('keeps an advisor edit through repeated live-record re-seeds in the same workspace', async () => {
    mailMocks.checkFolder.mockResolvedValue({ items: [] });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      records = [configRecord('Saved folder', 'saved@example.test')];
      const view = render(<EmailDropboxSurface />);
      await waitFor(() => {
        expect(screen.getByTestId('crm-email-dropbox-folder')).toHaveValue('Saved folder');
      });
      fireEvent.change(screen.getByTestId('crm-email-dropbox-folder'), {
        target: { value: 'Advisor typed folder' },
      });
      records = [{
        ...records[0],
        folderId: 'Late live refresh',
        updatedAt: `2026-07-17T00:01:0${String(attempt)}.000Z`,
      }];
      view.rerender(<EmailDropboxSurface />);
      await waitFor(() => {
        expect(screen.getByTestId('crm-email-dropbox-folder')).toHaveValue('Advisor typed folder');
      });
      view.unmount();
    }
  });

  it('fully isolates typed fields, email results, mappings, and late A requests when switching to workspace B', async () => {
    const aEmail = email('email-a-private', 'Client A private subject', 'a@example.test');
    const bEmail = email('email-b', 'Client B subject', 'b@example.test');
    const lateA = deferred<{ items: MailListItem[] }>();
    let aChecks = 0;
    mailMocks.checkFolder.mockImplementation(({ account }: { account?: string }) => {
      if (account === 'advisor-typed-a@example.test') {
        aChecks += 1;
        return aChecks === 1 ? Promise.resolve({ items: [aEmail] }) : lateA.promise;
      }
      if (account === 'b@example.test') return Promise.resolve({ items: [bEmail] });
      return Promise.resolve({ items: [] });
    });
    records = [
      configRecord('A folder', 'a@example.test'),
      householdRecord('household-a', 'Client A Private'),
    ];
    const view = render(<EmailDropboxSurface />);
    await waitFor(() => { expect(screen.getByTestId('crm-email-dropbox-account')).toHaveValue('a@example.test'); });

    fireEvent.change(screen.getByTestId('crm-email-dropbox-account'), {
      target: { value: 'advisor-typed-a@example.test' },
    });
    await waitFor(() => { expect(screen.getByTestId('crm-email-dropbox-email-email-a-private')).toBeInTheDocument(); });
    fireEvent.change(screen.getByTestId('crm-email-dropbox-household-email-a-private'), {
      target: { value: 'household-a' },
    });
    expect(screen.getByTestId('crm-email-dropbox-household-email-a-private')).toHaveValue('household-a');

    fireEvent.click(screen.getByTestId('crm-email-dropbox-check'));
    await waitFor(() => { expect(aChecks).toBe(2); });
    workspaceRoot = '/workspace-b';
    records = [
      configRecord('B folder', 'b@example.test'),
      householdRecord('household-b', 'Client B'),
    ];
    view.rerender(<EmailDropboxSurface />);

    expect(screen.getByTestId('crm-email-dropbox-account')).not.toHaveValue('advisor-typed-a@example.test');
    expect(screen.queryByText(/Client A private subject|Client A Private|private snippet/i)).not.toBeInTheDocument();
    await waitFor(() => { expect(screen.getByTestId('crm-email-dropbox-account')).toHaveValue('b@example.test'); });
    await waitFor(() => { expect(screen.getByTestId('crm-email-dropbox-email-email-b')).toBeInTheDocument(); });

    lateA.resolve({ items: [aEmail] });
    await waitFor(() => {
      expect(screen.queryByTestId('crm-email-dropbox-email-email-a-private')).not.toBeInTheDocument();
      expect(screen.getByTestId('crm-email-dropbox-email-email-b')).toBeInTheDocument();
    });
  });

  it('does not carry a typed A mailbox field into a successful direct workspace-B load with the same config record ID', async () => {
    mailMocks.checkFolder.mockResolvedValue({ items: [] });
    records = [configRecord('A saved folder', 'a@example.test')];
    const view = render(<EmailDropboxSurface />);
    await waitFor(() => {
      expect(screen.getByTestId('crm-email-dropbox-account')).toHaveValue('a@example.test');
    });
    fireEvent.change(screen.getByTestId('crm-email-dropbox-account'), {
      target: { value: 'advisor-typed-a@example.test' },
    });

    workspaceRoot = '/workspace-b';
    records = [configRecord('B saved folder', 'b@example.test')];
    view.rerender(<EmailDropboxSurface />);

    await waitFor(() => {
      expect(screen.getByTestId('crm-email-dropbox-account')).toHaveValue('b@example.test');
      expect(screen.getByTestId('crm-email-dropbox-folder')).toHaveValue('B saved folder');
    });
    expect(screen.queryByDisplayValue('advisor-typed-a@example.test')).not.toBeInTheDocument();
  });

  it('fails closed with empty B state when B records fail to load and discards late A mail', async () => {
    const aEmail = email('email-a-private', 'Client A private subject', 'a@example.test');
    const lateA = deferred<{ items: MailListItem[] }>();
    let aChecks = 0;
    mailMocks.checkFolder.mockImplementation(({ account }: { account?: string }) => {
      if (account === 'advisor-typed-a@example.test') {
        aChecks += 1;
        return aChecks === 1 ? Promise.resolve({ items: [aEmail] }) : lateA.promise;
      }
      return Promise.resolve({ items: [] });
    });
    records = [
      configRecord('A folder', 'a@example.test'),
      householdRecord('household-a', 'Client A Private'),
    ];
    const view = render(<EmailDropboxSurface />);
    await waitFor(() => { expect(screen.getByTestId('crm-email-dropbox-account')).toHaveValue('a@example.test'); });
    fireEvent.change(screen.getByTestId('crm-email-dropbox-account'), {
      target: { value: 'advisor-typed-a@example.test' },
    });
    await waitFor(() => { expect(screen.getByTestId('crm-email-dropbox-email-email-a-private')).toBeInTheDocument(); });
    fireEvent.change(screen.getByTestId('crm-email-dropbox-household-email-a-private'), {
      target: { value: 'household-a' },
    });
    fireEvent.click(screen.getByTestId('crm-email-dropbox-check'));
    await waitFor(() => { expect(aChecks).toBe(2); });

    workspaceRoot = '/workspace-b';
    records = [];
    loadError = 'B encrypted record store unavailable';
    view.rerender(<EmailDropboxSurface />);

    expect(screen.getByTestId('crm-email-dropbox-account')).toHaveValue('');
    expect(screen.getByTestId('crm-email-dropbox-folder')).toHaveValue('Lantern Dropbox');
    expect(screen.queryByText(/Client A private subject|Client A Private|private snippet/i)).not.toBeInTheDocument();
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('B encrypted record store unavailable'); });

    lateA.resolve({ items: [aEmail] });
    await waitFor(() => {
      expect(screen.queryByTestId('crm-email-dropbox-email-email-a-private')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('B encrypted record store unavailable');
    });
  });

  it('fully resets A fields and email state when the saved mailbox account changes to B in the same workspace', async () => {
    const aEmail = email('email-a-private', 'Client A private subject', 'a@example.test');
    const bEmail = email('email-b', 'Client B subject', 'b@example.test');
    mailMocks.checkFolder.mockImplementation(({ account }: { account?: string }) => Promise.resolve({
      items: account === 'a@example.test' ? [aEmail] : account === 'b@example.test' ? [bEmail] : [],
    }));
    records = [
      configRecord('A folder', 'a@example.test'),
      householdRecord('household-a', 'Client A Private'),
    ];
    const view = render(<EmailDropboxSurface />);
    await waitFor(() => { expect(screen.getByTestId('crm-email-dropbox-email-email-a-private')).toBeInTheDocument(); });
    fireEvent.change(screen.getByTestId('crm-email-dropbox-folder'), {
      target: { value: 'Advisor typed A folder' },
    });
    await waitFor(() => { expect(screen.getByTestId('crm-email-dropbox-email-email-a-private')).toBeInTheDocument(); });
    fireEvent.change(screen.getByTestId('crm-email-dropbox-household-email-a-private'), {
      target: { value: 'household-a' },
    });

    records = [
      configRecord('B folder', 'b@example.test'),
      householdRecord('household-b', 'Client B'),
    ];
    view.rerender(<EmailDropboxSurface />);

    expect(screen.getByTestId('crm-email-dropbox-folder')).toHaveValue('B folder');
    expect(screen.getByTestId('crm-email-dropbox-account')).toHaveValue('b@example.test');
    expect(screen.queryByText(/Client A private subject|Client A Private|private snippet/i)).not.toBeInTheDocument();
    await waitFor(() => { expect(screen.getByTestId('crm-email-dropbox-email-email-b')).toBeInTheDocument(); });
  });

  it('fails closed when account B mailbox loading fails in the same workspace', async () => {
    const aEmail = email('email-a-private', 'Client A private subject', 'a@example.test');
    mailMocks.checkFolder.mockImplementation(({ account }: { account?: string }) => {
      if (account === 'b-fails@example.test') return Promise.reject(new Error('B mailbox unavailable'));
      return Promise.resolve({ items: account === 'a@example.test' ? [aEmail] : [] });
    });
    records = [
      configRecord('A folder', 'a@example.test'),
      householdRecord('household-a', 'Client A Private'),
    ];
    render(<EmailDropboxSurface />);
    await waitFor(() => { expect(screen.getByTestId('crm-email-dropbox-email-email-a-private')).toBeInTheDocument(); });
    fireEvent.change(screen.getByTestId('crm-email-dropbox-household-email-a-private'), {
      target: { value: 'household-a' },
    });

    fireEvent.change(screen.getByTestId('crm-email-dropbox-account'), {
      target: { value: 'b-fails@example.test' },
    });

    expect(screen.queryByTestId('crm-email-dropbox-email-email-a-private')).not.toBeInTheDocument();
    expect(screen.queryByText(/Client A private subject|Client A Private|private snippet/i)).not.toBeInTheDocument();
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveTextContent('B mailbox unavailable'); });
    expect(screen.getByTestId('crm-email-dropbox-account')).toHaveValue('b-fails@example.test');
    expect(screen.queryByTestId('crm-email-dropbox-email-email-a-private')).not.toBeInTheDocument();
  });
});
