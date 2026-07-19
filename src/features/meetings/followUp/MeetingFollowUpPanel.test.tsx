import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftFollowUpModal } from '@/features/email';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type {
  MeetingProjection,
  SealedMeetingClientBoundary,
} from '../foundation/contract';
import type { MeetingPanelContext } from '../meetingWorkspaceTypes';
import { MeetingFollowUpPanel } from './MeetingFollowUpPanel';
import type {
  MeetingFollowUpRecap,
  MeetingFollowUpStore,
} from './meetingFollowUpStore';

const mail = vi.hoisted(() => ({
  accounts: vi.fn(),
  saveDraft: vi.fn(),
  send: vi.fn(),
}));

vi.mock('@/platform/utils/mail-commands', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/platform/utils/mail-commands')>();
  return {
    ...actual,
    mailConnectedAccounts: mail.accounts,
    mailSaveDraft: mail.saveDraft,
    mailSend: mail.send,
  };
});

vi.mock('@/features/email/emailAuditLog', () => ({
  emailMatterScope: (matterId: string) => ({ kind: 'matter', matterId }),
  effectiveModeForDestination: () => 'direct',
  logEmailAuditEntry: vi.fn(),
}));

vi.mock('@/platform/matter/matterStore', () => ({ useMatters: () => [] }));

const translations: Record<string, string> = {
  'meetings.entry.follow-up.loading': 'Loading follow-up',
  'meetings.entry.follow-up.not-produced': 'Follow-up not produced',
  'meetings.entry.follow-up.refused': 'Exact meeting required',
  'meetings.entry.follow-up.local-error': 'Could not load follow-up',
  'meetings.entry.follow-up.retry': 'Try again',
  'meetings.entry.follow-up.description': 'Edit and save to Outlook Drafts.',
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

describe('Meeting follow-up Outlook Drafts-only panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mail.accounts.mockResolvedValue([
      { provider: 'gmail', account: 'gmail', label: 'Gmail' },
      { provider: 'm365', account: 'default', label: 'Outlook' },
    ]);
    mail.saveDraft.mockResolvedValue('outlook-draft-1');
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
      save: vi.fn(),
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

  it('keeps a local read failure generic and retries without exposing raw errors', async () => {
    const read = vi
      .fn<MeetingFollowUpStore['read']>()
      .mockResolvedValueOnce({ kind: 'error' })
      .mockResolvedValueOnce({ kind: 'ready', recap: recap() });
    const store: MeetingFollowUpStore = { read, save: vi.fn() };
    render(<MeetingFollowUpPanel context={context()} store={store} />);
    expect(
      await screen.findByTestId('meeting-follow-up-local-error')
    ).toHaveTextContent('Could not load follow-up');
    fireEvent.click(screen.getByTestId('meeting-follow-up-retry'));
    expect(await screen.findByTestId('meeting-follow-up-panel')).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('renders an editable recap, saves one Outlook draft, and exposes no Send path', async () => {
    const save = vi.fn<MeetingFollowUpStore['save']>((target, input) =>
      input.state === 'saved-to-drafts'
        ? Promise.resolve({
            kind: 'ready',
            recap: recap({
              artifactId: 'follow-up-artifact-2',
              to: input.to,
              subject: input.subject,
              body: input.body,
              state: 'saved-to-drafts',
              outlookDraftId: input.outlookDraftId,
              householdRef: target.client.householdRef,
              matterId: target.client.matterId,
            }),
          })
        : Promise.resolve({ kind: 'refused' })
    );
    const store: MeetingFollowUpStore = {
      read: vi.fn<MeetingFollowUpStore['read']>(() =>
        Promise.resolve({ kind: 'ready', recap: recap() })
      ),
      save,
    };
    render(<MeetingFollowUpPanel context={context()} store={store} />);
    const body = await screen.findByTestId('followup-body');
    fireEvent.change(body, {
      target: { value: 'Edited exact-meeting recap.' },
    });
    expect(screen.getByTestId('meeting-follow-up-edited')).toBeTruthy();
    expect(screen.queryByTestId('followup-send')).toBeNull();
    expect(screen.queryByTestId('followup-generate')).toBeNull();

    fireEvent.click(screen.getByTestId('followup-save-drafts'));
    await waitFor(() => {
      expect(mail.saveDraft).toHaveBeenCalledTimes(1);
    });
    expect(mail.saveDraft).toHaveBeenCalledWith(
      'm365:default',
      ['client@example.test'],
      'Annual review recap',
      expect.stringContaining('Edited exact-meeting recap.')
    );
    expect(mail.send).not.toHaveBeenCalled();
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

  it('blocks clearly when no Outlook account is connected', async () => {
    mail.accounts.mockResolvedValueOnce([
      { provider: 'gmail', account: 'gmail', label: 'Gmail' },
    ]);
    const store: MeetingFollowUpStore = {
      read: vi.fn<MeetingFollowUpStore['read']>(() =>
        Promise.resolve({ kind: 'ready', recap: recap() })
      ),
      save: vi.fn(),
    };
    render(<MeetingFollowUpPanel context={context()} store={store} />);
    expect(
      await screen.findByTestId('meeting-follow-up-blocked')
    ).toHaveTextContent('Connect Outlook');
    expect(screen.queryByTestId('followup-save-drafts')).toBeNull();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('sanitizes a raw Outlook failure and keeps the explicit save retryable', async () => {
    mail.saveDraft.mockRejectedValueOnce(
      new Error('Graph 401 raw tenant secret detail')
    );
    render(
      <DraftFollowUpModal
        mode="outlook-drafts-only"
        inline
        open
        onOpenChange={() => undefined}
        meetingId="meeting-a"
        householdRef="household-a"
        matterId="matter-shared"
        draft={recap()}
      />
    );
    const save = await screen.findByTestId('followup-save-drafts');
    fireEvent.click(save);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The draft was not saved to Outlook');
    expect(alert).not.toHaveTextContent('401');
    expect(alert).not.toHaveTextContent('tenant secret');
    expect(save).not.toBeDisabled();
    expect(mail.send).not.toHaveBeenCalled();
  });
});
