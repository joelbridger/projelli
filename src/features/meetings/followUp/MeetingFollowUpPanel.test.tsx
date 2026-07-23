import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { TFunction } from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type {
  MeetingArtifact,
  MeetingArtifactInput,
  MeetingArtifactReader,
  MeetingArtifactStore,
  MeetingProjection,
  MeetingStore,
  SealedMeetingClientBoundary,
} from '../foundation/contract';
import type { MeetingPanelContext } from '../meetingWorkspaceTypes';
import { MeetingFollowUpPanel } from './MeetingFollowUpPanel';
import {
  createMeetingFollowUpStore,
  type MeetingFollowUpRecap,
  type MeetingFollowUpStore,
  type MeetingFollowUpTarget,
  type ProviderSaveClaim,
} from './meetingFollowUpStore';

const mail = vi.hoisted(() => ({
  accounts: vi.fn(),
  saveDraft: vi.fn(),
}));
const external = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock('@/platform/utils/mail-commands', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/platform/utils/mail-commands')>();
  return {
    ...actual,
    mailConnectedAccounts: mail.accounts,
    mailSaveDraft: mail.saveDraft,
  };
});

vi.mock('@/platform/matter/matterStore', () => ({ useMatters: () => [] }));
vi.mock('@/platform/utils/openExternal', () => ({
  openExternal: external.open,
}));

const translations: Record<string, string> = {
  'meetings.entry.follow-up.loading': 'Loading follow-up',
  'meetings.entry.follow-up.not-produced': 'Follow-up not produced',
  'meetings.entry.follow-up.refused': 'Exact meeting required',
  'meetings.entry.follow-up.local-error': 'Could not load follow-up',
  'meetings.entry.follow-up.retry': 'Try again',
  'meetings.entry.follow-up.description': 'Edit and save to Outlook Drafts.',
  'meetings.entry.tab-follow-up': 'Follow-up',
  'common.actions.create': 'Create',
};

function boundary(householdRef = 'household-a'): SealedMeetingClientBoundary {
  return {
    householdRef,
    matterId: 'matter-shared',
  } as SealedMeetingClientBoundary;
}

function meeting(client = boundary()): MeetingProjection {
  return {
    id: 'meeting-a',
    workspaceId: 'workspace-1',
    householdRef: client.householdRef,
    matterId: client.matterId,
    typeId: 'review',
    ownerRef: 'advisor-1',
    scheduledStartUtc: '2026-07-20T09:00:00.000Z',
    scheduledEndUtc: '2026-07-20T10:00:00.000Z',
    timezone: 'America/Chicago',
    state: 'completed',
    references: [],
  };
}

function context(client = boundary()): MeetingPanelContext {
  return {
    t: ((key: string) => translations[key] ?? key) as TFunction,
    matterId: client.matterId,
    canonicalMeeting: meeting(client),
    clientBoundary: client,
    meetingDir: '/workspace/meeting-a',
    clientName: 'Alpha Household',
    workspaceRoot: '/workspace',
    workspaceService: null as WorkspaceService | null,
    firm: { org: null, role: null },
    meta: null,
    transcript: null,
    summaryExtraction: null,
    summaryText: '',
    audioSrc: null,
    renderAudioPlayer: () => null,
    seekMs: undefined,
    hasAudio: false,
    hasNotes: false,
    summaryReady: false,
    crmBlockedReason: null,
    retryingNotes: false,
    retryingTranscript: false,
    onSeek: vi.fn(),
    onRetryNotes: vi.fn(),
    onRetryTranscript: vi.fn(),
  };
}

function recap(
  overrides: Partial<MeetingFollowUpRecap> = {}
): MeetingFollowUpRecap {
  return {
    artifactId: 'follow-up-artifact-1',
    recapKey: 'meeting-follow-up-key',
    meetingId: 'meeting-a',
    householdRef: 'household-a',
    matterId: 'matter-shared',
    producedAt: '2026-07-20T10:00:00.000Z',
    to: 'client@example.test',
    subject: 'Annual review recap',
    body: 'Thank you for meeting today.',
    state: 'edited',
    ...overrides,
  };
}

function receiptAwareSave(
  complete: (
    input: Parameters<MeetingFollowUpStore['save']>[1]
  ) => MeetingFollowUpRecap = (input) =>
    recap({
      artifactId: 'follow-up-artifact-2',
      to: input.to,
      subject: input.subject,
      body: input.body,
      state: input.state,
      ...(input.state === 'saved-to-drafts'
        ? { outlookDraftId: input.outlookDraftId }
        : {}),
      ...(input.state !== 'edited'
        ? {
            draftProvider: input.draftProvider,
            draftAccount: input.draftAccount,
            draftAccountLabel: input.draftAccountLabel,
          }
        : {}),
    })
) {
  return vi.fn<MeetingFollowUpStore['save']>((_target, input) =>
    Promise.resolve({
      kind: 'ready' as const,
      recap: complete(input),
    })
  );
}

function productionStoreHarness() {
  const client = boundary();
  const meetings: MeetingStore = {
    list: [meeting(client)],
    error: null,
    get: vi.fn(),
    createDraft: vi.fn(),
    update: vi.fn(),
    transition: vi.fn(),
  };
  const records: MeetingArtifact[] = [];
  let appendAttempt = 0;
  const failedAppendAttempts = new Set<number>();
  const artifacts: MeetingArtifactStore = {
    readerFor: (_meetings, requestedClient): MeetingArtifactReader => ({
      listForMeeting: (meetingId, kinds) =>
        records.filter(
          (artifact) =>
            artifact.meetingId === meetingId &&
            artifact.householdRef === requestedClient.householdRef &&
            artifact.matterId === requestedClient.matterId &&
            (!kinds || kinds.includes(artifact.kind))
        ),
      get: (id) => records.find((artifact) => artifact.id === id) ?? null,
    }),
    append: vi.fn((input: MeetingArtifactInput) => {
      appendAttempt += 1;
      if (failedAppendAttempts.has(appendAttempt)) {
        return Promise.reject(new Error('simulated local artifact failure'));
      }
      const artifact: MeetingArtifact = {
        ...input,
        id: `artifact-${String(records.length + 1)}`,
        householdRef: client.householdRef,
        matterId: client.matterId,
        state: 'produced',
        createdAt: input.producedAt,
      };
      records.push(artifact);
      return Promise.resolve(artifact);
    }),
    approve: vi.fn(),
  };
  const target: MeetingFollowUpTarget = {
    meetingId: 'meeting-a',
    client,
  };
  const defaultProviderSaveClaim: ProviderSaveClaim = async (claim) => {
    await artifacts.append({
      meetingId: claim.meetingId,
      kind: 'follow-up-draft',
      schemaVersion: 1,
      producedAt: new Date().toISOString(),
      sourceRefs: [],
      provenance: 'local-entry',
      payload: {
        recapKey: claim.recapKey,
        to: claim.to,
        subject: claim.subject,
        body: claim.body,
        deliveryState: 'provider-save-pending',
        draftProvider: claim.provider,
        draftAccount: claim.account,
        draftAccountLabel: claim.accountLabel,
      },
    });
    return { outcome: 'acquired' };
  };
  const createStore = (claim = defaultProviderSaveClaim) =>
    createMeetingFollowUpStore(meetings, artifacts, undefined, claim);
  return {
    records,
    store: createStore(),
    createStore,
    target,
    failAppendAttempts(...attempts: number[]) {
      for (const attempt of attempts) failedAppendAttempts.add(attempt);
    },
  };
}

describe('Meeting follow-up provider Drafts-only panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mail.accounts.mockResolvedValue([
      { provider: 'm365', account: 'default', label: 'Outlook' },
      { provider: 'gmail', account: 'gmail', label: 'Gmail' },
    ]);
    mail.saveDraft.mockResolvedValue('outlook-draft-1');
    external.open.mockResolvedValue(undefined);
  });

  it('shows loading and then the honest not-produced state', async () => {
    let finish!: (value: { kind: 'not-produced' }) => void;
    const read = vi.fn<MeetingFollowUpStore['read']>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const store: MeetingFollowUpStore = {
      read,
      start: vi.fn(),
      save: vi.fn(),
      claimProviderSave: vi.fn().mockResolvedValue({ kind: 'acquired' }),
    };
    render(<MeetingFollowUpPanel context={context()} store={store} />);
    expect(screen.getByTestId('meeting-follow-up-loading')).toBeTruthy();
    await waitFor(() => {
      expect(read).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      finish({ kind: 'not-produced' });
      await Promise.resolve();
    });
    expect(
      await screen.findByTestId('meeting-follow-up-not-produced')
    ).toHaveTextContent('Follow-up not produced');
  });

  it('runs not-produced through a real edited artifact and into Outlook Drafts', async () => {
    const lane = productionStoreHarness();
    await expect(lane.store.read(lane.target)).resolves.toEqual({
      kind: 'not-produced',
    });

    render(<MeetingFollowUpPanel context={context()} store={lane.store} />);
    await screen.findByTestId('meeting-follow-up-not-produced');
    const start = screen.getByTestId('meeting-follow-up-start');
    expect(start).toHaveTextContent('Create Follow-up');
    fireEvent.click(start);

    const body = await screen.findByTestId('followup-drafts-body');
    expect(lane.records).toHaveLength(1);
    expect(lane.records[0]).toMatchObject({
      meetingId: 'meeting-a',
      householdRef: 'household-a',
      matterId: 'matter-shared',
      kind: 'follow-up-draft',
      payload: {
        to: '',
        subject: '',
        body: '',
        deliveryState: 'edited',
      },
    });
    await expect(lane.store.read(lane.target)).resolves.toMatchObject({
      kind: 'ready',
      recap: {
        meetingId: 'meeting-a',
        householdRef: 'household-a',
        matterId: 'matter-shared',
        state: 'edited',
      },
    });

    fireEvent.change(screen.getByTestId('followup-drafts-to'), {
      target: { value: 'client@example.test' },
    });
    fireEvent.change(screen.getByTestId('followup-drafts-subject'), {
      target: { value: 'Annual review recap' },
    });
    fireEvent.change(body, {
      target: { value: 'Edited exact-meeting recap.' },
    });
    expect(screen.queryByTestId('followup-send')).toBeNull();
    fireEvent.click(screen.getByTestId('followup-drafts-save'));

    expect(
      await screen.findByTestId('meeting-follow-up-saved')
    ).toHaveTextContent('Nothing was sent');
    expect(mail.saveDraft).toHaveBeenCalledTimes(1);
    expect(external.open).toHaveBeenCalledWith(
      'https://outlook.office.com/mail/?path=/mail/drafts'
    );
    expect(lane.records).toHaveLength(3);
    expect(lane.records[1]).toMatchObject({
      meetingId: 'meeting-a',
      householdRef: 'household-a',
      matterId: 'matter-shared',
      payload: {
        body: 'Edited exact-meeting recap.',
        deliveryState: 'provider-save-pending',
        draftProvider: 'm365',
        draftAccount: 'default',
      },
    });
    expect(lane.records[2]).toMatchObject({
      meetingId: 'meeting-a',
      householdRef: 'household-a',
      matterId: 'matter-shared',
      payload: {
        body: 'Edited exact-meeting recap.',
        deliveryState: 'saved-to-drafts',
        outlookDraftId: 'outlook-draft-1',
      },
    });
  });

  it('lets two separately created panels reach the provider save only once', async () => {
    let arrived = 0;
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquired = false;
    const sharedClaim = async (): Promise<{
      outcome: 'acquired' | 'alreadyClaimed';
    }> => {
      arrived += 1;
      if (arrived === 2) release();
      await released;
      if (acquired) return { outcome: 'alreadyClaimed' };
      acquired = true;
      return { outcome: 'acquired' };
    };
    const makeStore = (): MeetingFollowUpStore => ({
      read: vi.fn<MeetingFollowUpStore['read']>(() =>
        Promise.resolve({
          kind: 'ready',
          recap: recap({
            to: 'client@example.test',
            subject: 'Exact meeting recap',
            body: 'One exact-meeting recap.',
          }),
        })
      ),
      start: vi.fn(),
      save: receiptAwareSave(),
      claimProviderSave: async () => {
        const result = await sharedClaim();
        return result.outcome === 'acquired'
          ? { kind: 'acquired' as const }
          : { kind: 'already-claimed' as const };
      },
    });
    render(
      <>
        <MeetingFollowUpPanel context={context()} store={makeStore()} />
        <MeetingFollowUpPanel context={context()} store={makeStore()} />
      </>
    );
    for (const save of await screen.findAllByTestId('followup-drafts-save')) {
      fireEvent.click(save);
    }

    await waitFor(() => {
      expect(mail.saveDraft).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps a local read failure generic and retries without exposing raw errors', async () => {
    const read = vi
      .fn<MeetingFollowUpStore['read']>()
      .mockResolvedValueOnce({ kind: 'error' })
      .mockResolvedValueOnce({ kind: 'ready', recap: recap() });
    const store: MeetingFollowUpStore = {
      read,
      start: vi.fn(),
      save: vi.fn(),
      claimProviderSave: vi.fn().mockResolvedValue({ kind: 'acquired' }),
    };
    render(<MeetingFollowUpPanel context={context()} store={store} />);
    expect(
      await screen.findByTestId('meeting-follow-up-local-error')
    ).toHaveTextContent('Could not load follow-up');
    fireEvent.click(screen.getByTestId('meeting-follow-up-retry'));
    expect(await screen.findByTestId('meeting-follow-up-panel')).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('refuses a different household even when the meeting id is the same', async () => {
    const lane = productionStoreHarness();
    const otherClient = boundary('household-b');
    await expect(
      lane.store.read({ meetingId: 'meeting-a', client: otherClient })
    ).resolves.toEqual({ kind: 'refused' });
    await expect(
      lane.store.save(
        { meetingId: 'meeting-a', client: otherClient },
        {
          to: 'client@example.test',
          subject: 'Wrong household',
          body: 'This must not cross the client boundary.',
          state: 'saved-to-drafts',
          outlookDraftId: 'outlook-draft-1',
          draftProvider: 'm365',
          draftAccount: 'default',
          draftAccountLabel: 'Outlook',
        }
      )
    ).resolves.toEqual({ kind: 'refused' });
  });

  it('treats Gmail /u/0/ Drafts as provider-only and names the selected account', async () => {
    mail.accounts.mockResolvedValueOnce([
      {
        provider: 'm365',
        account: 'default',
        label: 'Outlook — other@firm.test',
      },
      {
        provider: 'gmail',
        account: 'gmail',
        label: 'Gmail — advisor@firm.test',
      },
    ]);
    const store: MeetingFollowUpStore = {
      read: vi.fn<MeetingFollowUpStore['read']>(() =>
        Promise.resolve({ kind: 'ready', recap: recap() })
      ),
      start: vi.fn(),
      save: receiptAwareSave(),
      claimProviderSave: vi.fn().mockResolvedValue({ kind: 'acquired' }),
    };
    render(<MeetingFollowUpPanel context={context()} store={store} />);
    const account = await screen.findByTestId('followup-drafts-account');
    expect(account).toHaveTextContent('Outlook');
    expect(account).toHaveTextContent('Gmail');
    fireEvent.change(account, { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('followup-drafts-save'));
    await waitFor(() => {
      expect(mail.saveDraft).toHaveBeenCalledWith(
        'gmail:gmail',
        ['client@example.test'],
        'Annual review recap',
        expect.any(String)
      );
    });
    expect(external.open).toHaveBeenCalledWith(
      'https://mail.google.com/mail/u/0/#drafts'
    );
    expect(
      await screen.findByTestId('meeting-follow-up-saved')
    ).toHaveTextContent(
      'If another account opens, switch to Gmail — advisor@firm.test, then review and press Send there.'
    );
    expect(screen.getByTestId('meeting-follow-up-saved')).not.toHaveTextContent(
      'Gmail — advisor@firm.test Drafts is open'
    );
  });

  it('renders an editable recap, saves one Outlook draft, and exposes no Send path', async () => {
    const save = receiptAwareSave((input) =>
      recap({
        artifactId: 'follow-up-artifact-2',
        to: input.to,
        subject: input.subject,
        body: input.body,
        state: input.state,
        ...(input.state === 'saved-to-drafts'
          ? { outlookDraftId: input.outlookDraftId }
          : {}),
        ...(input.state !== 'edited'
          ? {
              draftProvider: input.draftProvider,
              draftAccount: input.draftAccount,
              draftAccountLabel: input.draftAccountLabel,
            }
          : {}),
      })
    );
    const store: MeetingFollowUpStore = {
      read: vi.fn<MeetingFollowUpStore['read']>(() =>
        Promise.resolve({ kind: 'ready', recap: recap() })
      ),
      start: vi.fn(),
      save,
      claimProviderSave: vi.fn().mockResolvedValue({ kind: 'acquired' }),
    };
    render(<MeetingFollowUpPanel context={context()} store={store} />);
    const body = await screen.findByTestId('followup-drafts-body');
    fireEvent.change(body, {
      target: { value: 'Edited exact-meeting recap.' },
    });
    expect(screen.getByTestId('followup-drafts-edited')).toBeTruthy();
    expect(screen.queryByTestId('followup-send')).toBeNull();
    expect(screen.queryByTestId('followup-generate')).toBeNull();

    fireEvent.click(screen.getByTestId('followup-drafts-save'));
    await waitFor(() => {
      expect(mail.saveDraft).toHaveBeenCalledTimes(1);
    });
    expect(mail.saveDraft).toHaveBeenCalledWith(
      'm365:default',
      ['client@example.test'],
      'Annual review recap',
      expect.stringContaining('Edited exact-meeting recap.')
    );
    const savedTarget = save.mock.calls[0]?.[0];
    const savedInput = save.mock.calls[0]?.[1];
    expect(savedTarget?.meetingId).toBe('meeting-a');
    expect(savedTarget?.client.householdRef).toBe('household-a');
    expect(savedTarget?.client.matterId).toBe('matter-shared');
    expect(savedInput).toMatchObject({
      body: 'Edited exact-meeting recap.',
      state: 'saved-to-drafts',
      outlookDraftId: 'outlook-draft-1',
    });
    expect(
      await screen.findByTestId('meeting-follow-up-saved')
    ).toHaveTextContent('Nothing was sent');
  });

  it('blocks clearly when neither Outlook nor Gmail is connected', async () => {
    mail.accounts.mockResolvedValueOnce([
      { provider: 'imap', account: 'firm@example.test', label: 'Firm IMAP' },
    ]);
    const store: MeetingFollowUpStore = {
      read: vi.fn<MeetingFollowUpStore['read']>(() =>
        Promise.resolve({ kind: 'ready', recap: recap() })
      ),
      start: vi.fn(),
      save: vi.fn(),
      claimProviderSave: vi.fn().mockResolvedValue({ kind: 'acquired' }),
    };
    render(<MeetingFollowUpPanel context={context()} store={store} />);
    expect(
      await screen.findByTestId('meeting-follow-up-blocked')
    ).toHaveTextContent('Connect Outlook or Gmail');
    expect(screen.queryByTestId('followup-drafts-save')).toBeNull();
  });

  it('records an ambiguous provider rejection as unresolved and makes another save unreachable', async () => {
    mail.saveDraft.mockRejectedValueOnce(
      new Error('Graph 401 raw tenant secret detail')
    );
    const lane = productionStoreHarness();
    await lane.store.start(lane.target);
    const rendered = render(
      <MeetingFollowUpPanel context={context()} store={lane.store} />
    );
    fireEvent.change(await screen.findByTestId('followup-drafts-to'), {
      target: { value: 'client@example.test' },
    });
    fireEvent.change(screen.getByTestId('followup-drafts-body'), {
      target: { value: 'Exact meeting follow-up.' },
    });
    const save = await screen.findByTestId('followup-drafts-save');
    fireEvent.click(save);
    const alert = await screen.findByTestId('meeting-follow-up-unresolved');
    expect(alert).toHaveTextContent(
      'cannot confirm whether a draft was created'
    );
    expect(alert).toHaveTextContent('Outlook');
    expect(alert).not.toHaveTextContent('401');
    expect(alert).not.toHaveTextContent('tenant secret');
    expect(screen.queryByTestId('followup-drafts-save')).toBeNull();
    expect(screen.queryByTestId('followup-drafts-account')).toBeNull();
    expect(mail.saveDraft).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('followup-drafts-open-locked-folder'));
    await waitFor(() => {
      expect(external.open).toHaveBeenCalledWith(
        'https://outlook.office.com/mail/?path=/mail/drafts'
      );
    });
    expect(lane.records).toHaveLength(3);
    expect(lane.records[2]).toMatchObject({
      payload: {
        deliveryState: 'provider-save-unknown',
        draftProvider: 'm365',
        draftAccount: 'default',
        draftAccountLabel: 'Outlook',
      },
    });
    rendered.rerender(
      <MeetingFollowUpPanel
        context={context(boundary('household-b'))}
        store={lane.store}
      />
    );
    expect(await screen.findByTestId('meeting-follow-up-refused')).toBeTruthy();
    expect(mail.saveDraft).toHaveBeenCalledTimes(1);
    rendered.unmount();
    render(<MeetingFollowUpPanel context={context()} store={lane.store} />);
    expect(
      await screen.findByTestId('meeting-follow-up-unresolved')
    ).toHaveTextContent(
      'If another account opens, switch to Outlook, then inspect its Drafts folder'
    );
    expect(mail.saveDraft).toHaveBeenCalledTimes(1);
  });

  it('keeps a provider account-check failure generic and retryable', async () => {
    mail.accounts
      .mockRejectedValueOnce(new Error('raw account token detail'))
      .mockResolvedValueOnce([
        { provider: 'm365', account: 'default', label: 'Outlook' },
      ]);
    const store: MeetingFollowUpStore = {
      read: vi.fn<MeetingFollowUpStore['read']>(() =>
        Promise.resolve({ kind: 'ready', recap: recap() })
      ),
      start: vi.fn(),
      save: vi.fn(),
      claimProviderSave: vi.fn().mockResolvedValue({ kind: 'acquired' }),
    };
    render(<MeetingFollowUpPanel context={context()} store={store} />);

    const error = await screen.findByTestId('followup-drafts-local-error');
    expect(error).toHaveTextContent('draft accounts could not be checked');
    expect(error).not.toHaveTextContent('token');
    fireEvent.click(screen.getByTestId('followup-drafts-retry'));
    expect(await screen.findByTestId('followup-drafts-body')).toHaveValue(
      'Thank you for meeting today.'
    );
  });

  it('keeps the durable pending receipt locked across full unmount and remount when local completion fails', async () => {
    const lane = productionStoreHarness();
    await lane.store.start(lane.target);
    // Start is append 1, receipt is append 2; both completion records fail.
    lane.failAppendAttempts(3, 4);
    const rendered = render(
      <MeetingFollowUpPanel context={context()} store={lane.store} />
    );
    fireEvent.change(await screen.findByTestId('followup-drafts-to'), {
      target: { value: 'client@example.test' },
    });
    fireEvent.change(screen.getByTestId('followup-drafts-body'), {
      target: { value: 'Exact meeting follow-up.' },
    });
    fireEvent.click(await screen.findByTestId('followup-drafts-save'));
    expect(
      await screen.findByTestId('meeting-follow-up-unresolved')
    ).toHaveTextContent('Do not save another provider draft');
    expect(mail.saveDraft).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(lane.records).toHaveLength(2);
    });
    rendered.unmount();
    render(<MeetingFollowUpPanel context={context()} store={lane.store} />);
    expect(
      await screen.findByTestId('meeting-follow-up-unresolved')
    ).toHaveTextContent(
      'If another account opens, switch to Outlook, then inspect its Drafts folder'
    );
    expect(mail.saveDraft).toHaveBeenCalledTimes(1);
  });

  it('gives Outlook the same provider-only account-switch guidance', async () => {
    mail.accounts.mockResolvedValueOnce([
      {
        provider: 'm365',
        account: 'default',
        label: 'Outlook — advisor@firm.test',
      },
    ]);
    const store: MeetingFollowUpStore = {
      read: vi.fn<MeetingFollowUpStore['read']>(() =>
        Promise.resolve({ kind: 'ready', recap: recap() })
      ),
      start: vi.fn(),
      save: receiptAwareSave(),
      claimProviderSave: vi.fn().mockResolvedValue({ kind: 'acquired' }),
    };
    render(<MeetingFollowUpPanel context={context()} store={store} />);
    fireEvent.click(await screen.findByTestId('followup-drafts-save'));
    const saved = await screen.findByTestId('meeting-follow-up-saved');
    expect(saved).toHaveTextContent(
      'If another account opens, switch to Outlook — advisor@firm.test, then review and press Send there.'
    );
    expect(saved).not.toHaveTextContent(
      'Outlook — advisor@firm.test Drafts is open'
    );
  });

  it('never claims the Drafts folder opened when the provider handoff fails', async () => {
    external.open.mockRejectedValueOnce(new Error('raw browser detail'));
    const store: MeetingFollowUpStore = {
      read: vi.fn<MeetingFollowUpStore['read']>(() =>
        Promise.resolve({ kind: 'ready', recap: recap() })
      ),
      start: vi.fn(),
      save: receiptAwareSave(),
      claimProviderSave: vi.fn().mockResolvedValue({ kind: 'acquired' }),
    };
    render(<MeetingFollowUpPanel context={context()} store={store} />);
    fireEvent.click(await screen.findByTestId('followup-drafts-save'));
    const saved = await screen.findByTestId('meeting-follow-up-saved');
    expect(saved).toHaveTextContent('Open Outlook Drafts');
    expect(saved).toHaveTextContent(
      'If another account opens, switch to Outlook'
    );
    expect(saved).not.toHaveTextContent('Outlook Drafts is open');
    expect(saved).not.toHaveTextContent('raw browser detail');
  });
});
