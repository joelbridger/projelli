import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { MailListItem } from '@/platform/utils/mail-commands';
import { BRAND } from '@/config/brand';
import { assertCrossContextIsolation } from '@/testing/cross-context-isolation';
import { EmailDropboxSurface } from './EmailDropboxSurface';

const mailMocks = vi.hoisted(() => ({
  checkFolder: vi.fn(),
  retag: vi.fn(),
}));

let records: Record<string, unknown>[] = [];
let workspaceRoot: string | null = '/workspace-a';
let loadError: string | null = null;
const save = vi.fn<(record: LiveCrmRecord) => Promise<LiveCrmRecord>>();

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

  it('uses the shared complete cross-context isolation probe', async () => {
    const aEmail = email('email-a-private', 'Client A private subject', 'a@example.test');
    const bEmail = email('email-b', 'Client B subject', 'b@example.test');
    let view: ReturnType<typeof render> | undefined;
    let aChecks = 0;
    let lateA = deferred<{ items: MailListItem[] }>();
    mailMocks.checkFolder.mockImplementation(({ account }: { account?: string }) => {
      if (account === 'advisor-typed-a@example.test') return ++aChecks === 1 ? Promise.resolve({ items: [aEmail] }) : lateA.promise;
      return Promise.resolve({ items: account === 'b@example.test' ? [bEmail] : [] });
    });
    await assertCrossContextIsolation({
      name: 'Email Dropbox workspace switch',
      identity: { contextA: '/workspace-a', contextB: '/workspace-b', sameRecordId: 'email-dropbox-config:current-user', sameFieldId: 'crm-email-dropbox-account' },
      renderSurface: async () => { workspaceRoot = '/workspace-a'; loadError = null; records = [configRecord('A folder', 'a@example.test'), householdRecord('household-a', 'Client A Private')]; aChecks = 0; lateA = deferred<{ items: MailListItem[] }>(); view?.unmount(); view = render(<EmailDropboxSurface />); await waitFor(() => { expect(screen.getByTestId('crm-email-dropbox-account')).toHaveValue('a@example.test'); }); },
      typeIntoField: async () => { fireEvent.change(screen.getByTestId('crm-email-dropbox-account'), { target: { value: 'advisor-typed-a@example.test' } }); await screen.findByTestId('crm-email-dropbox-email-email-a-private'); fireEvent.change(screen.getByTestId('crm-email-dropbox-household-email-a-private'), { target: { value: 'household-a' } }); fireEvent.click(screen.getByTestId('crm-email-dropbox-check')); await waitFor(() => { expect(aChecks).toBe(2); }); return { typedA: 'advisor-typed-a@example.test', loadedA: ['Client A private subject', 'Client A Private'] }; },
      reseedSameContext: () => { records = [{ ...configRecord('Late A folder', 'a@example.test'), updatedAt: '2026-07-17T00:02:00.000Z' }, householdRecord('household-a', 'Client A Private')]; view?.rerender(<EmailDropboxSurface />); },
      switchContext: (load) => { workspaceRoot = '/workspace-b'; if (load === 'success') { records = [configRecord('B folder', 'b@example.test'), householdRecord('household-b', 'Client B')]; loadError = null; } else { records = []; loadError = 'B encrypted record store unavailable'; } view?.rerender(<EmailDropboxSurface />); },
      waitForBSuccess: async () => { await screen.findByTestId('crm-email-dropbox-email-email-b'); },
      waitForBFailure: async () => { await waitFor(() => { expect(screen.getByTestId('crm-email-dropbox-account')).toHaveValue(''); }); },
      assertATypedValueVisible: () => { expect(screen.getByTestId('crm-email-dropbox-account')).toHaveValue('advisor-typed-a@example.test'); },
      assertWithinContextEditPreserved: () => { expect(screen.getByTestId('crm-email-dropbox-account')).toHaveValue('advisor-typed-a@example.test'); },
      assertBSuccessLoaded: () => { expect(screen.getByTestId('crm-email-dropbox-account')).toHaveValue('b@example.test'); expect(screen.getByTestId('crm-email-dropbox-email-email-b')).toBeInTheDocument(); },
      assertBFailureIsFailClosed: () => { expect(screen.getByTestId('crm-email-dropbox-account')).toHaveValue(''); expect(screen.getByTestId('crm-email-dropbox-folder')).toHaveValue(`${BRAND.name} Dropbox`); },
      assertNoAContentInFields: ({ typedA, loadedA }) => { expect(screen.queryByDisplayValue(typedA)).not.toBeInTheDocument(); for (const marker of loadedA) expect(document.body.textContent).not.toContain(marker); },
      assertNoAContentInUnderlyingState: async (_, phase) => {
        save.mockClear();
        fireEvent.click(screen.getByTestId('crm-email-dropbox-save'));
        await waitFor(() => { expect(save).toHaveBeenCalled(); });
        expect(save.mock.calls.at(-1)?.[0]).not.toMatchObject({ account: 'advisor-typed-a@example.test' });
        const bMapping = phase === 'B loaded' ? screen.queryByTestId('crm-email-dropbox-household-email-b') : null;
        if (bMapping) {
          fireEvent.change(bMapping, { target: { value: 'household-b' } });
          fireEvent.click(screen.getByTestId('crm-email-dropbox-file-email-b'));
          await waitFor(() => { expect(save.mock.calls.some(([record]) => record.id === 'email-dropbox:email-b:household-b')).toBe(true); });
          const savedMapping = save.mock.calls.find(([record]) => record.id === 'email-dropbox:email-b:household-b')?.[0];
          expect(savedMapping).toMatchObject({ matterId: 'household-b', householdId: 'household-b' });
          expect(savedMapping).not.toMatchObject({ matterId: 'household-a', householdId: 'household-a' });
        }
      },
      resolveLateAWrite: async () => { await act(async () => { lateA.resolve({ items: [aEmail] }); await lateA.promise; }); },
    });
  });

  it('keeps the legacy default folder for mailbox lookup while showing the public name', async () => {
    mailMocks.checkFolder.mockResolvedValue({ items: [] });
    render(<EmailDropboxSurface />);

    expect(screen.getByTestId('crm-email-dropbox-folder')).toHaveValue(`${BRAND.name} Dropbox`);
    await waitFor(() => {
      expect(mailMocks.checkFolder).not.toHaveBeenCalled();
    });
    fireEvent.click(screen.getByTestId('crm-email-dropbox-check'));
    await waitFor(() => {
      expect(mailMocks.checkFolder).toHaveBeenCalledWith({ folderName: 'Lantern Dropbox' });
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
