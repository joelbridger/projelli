import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeetingSendPanel } from '@/features/meetings/MeetingSendPanel';
import { emptyMeetingRecipientArtifacts, type MeetingDeliveryPlan } from '@/features/meetings/meetingRecipientPlan';
import type { MeetingMeta } from '@/features/meetings/meetingStore';

vi.mock('@/platform/utils/mail-commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/utils/mail-commands')>();
  return {
    ...actual,
    mailConnectedAccounts: vi.fn(async () => [{ provider: 'm365', account: 'default', label: 'Outlook' }]),
  };
});

const localOnlyState = { value: false };
vi.mock('@/platform/privacy/localOnlyGuard', () => ({
  isPersistedLocalOnly: () => localOnlyState.value,
}));

const NOW = '2026-07-07T12:00:00.000Z';

function plan(): MeetingDeliveryPlan {
  return {
    version: 1,
    updatedAt: NOW,
    artifacts: {
      ...emptyMeetingRecipientArtifacts(),
      summary: [{ email: 'client@example.com', name: 'Client', source: 'manual' }],
    },
  };
}

function meta(overrides: Partial<MeetingMeta> = {}): MeetingMeta {
  return {
    matterId: 'matter-1',
    startedAt: NOW,
    customTitle: 'Annual review',
    reviewedAt: NOW,
    consent: { mode: 'one-party', confirmedBy: 'advisor', confirmedAt: NOW },
    deliveryPlan: plan(),
    ...overrides,
  };
}

function makeWorkspace(files = new Map<string, string>()) {
  files.set('/client/Meetings/one/meeting.json', JSON.stringify(meta()));
  return {
    files,
    readFile: vi.fn(async (path: string) => files.get(path) ?? ''),
    writeFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    readFileBinary: vi.fn(),
    exists: vi.fn(async () => false),
  };
}

function renderPanel(opts: { inputMeta?: MeetingMeta; ws?: ReturnType<typeof makeWorkspace>; onChanged?: () => void } = {}) {
  const ws = opts.ws ?? makeWorkspace();
  const onChanged = opts.onChanged ?? vi.fn();
  const utils = render(
    <MeetingSendPanel
      matterId="matter-1"
      meetingDir="/client/Meetings/one"
      meta={opts.inputMeta ?? meta()}
      matter={null}
      clientName="Hendricks"
      workspaceService={ws as never}
      hasAudio={false}
      hasTranscript={false}
      hasNotes={false}
      summaryReady={true}
      transcript={null}
      buildSummaryDocxBytes={async () => new Uint8Array([1, 2, 3])}
      onChanged={onChanged}
    />,
  );
  return { ...utils, ws, onChanged };
}

describe('MeetingSendPanel (merged send surface)', () => {
  beforeEach(() => {
    localOnlyState.value = false;
    vi.clearAllMocks();
  });
  afterEach(() => {
    localOnlyState.value = false;
  });

  it('is one surface: recipient planning and the single Review send action live together', async () => {
    renderPanel();
    // The two old separate boxes are gone; one primary action.
    expect(screen.getByTestId('meeting-send-panel')).toBeInTheDocument();
    const review = await screen.findByTestId('meeting-send-review');
    await waitFor(() => expect(review).toBeEnabled());
    // No inline To/Subject/Body in the default view (item 11) — only a ready count.
    expect(screen.queryByText(/^To:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Subject:/)).not.toBeInTheDocument();
  });

  it('(a) blocks Review send until there is a reviewed meeting', async () => {
    renderPanel({ inputMeta: meta({ reviewedAt: undefined }) });
    const review = await screen.findByTestId('meeting-send-review');
    expect(review).toBeDisabled();
  });

  it('(a) blocks Review send with no selected recipients', async () => {
    renderPanel({
      inputMeta: meta({ deliveryPlan: { version: 1, updatedAt: NOW, artifacts: emptyMeetingRecipientArtifacts() } }),
    });
    const review = await screen.findByTestId('meeting-send-review');
    expect(review).toBeDisabled();
  });

  it('(b) Local-only mode blocks send', async () => {
    localOnlyState.value = true;
    renderPanel();
    const review = await screen.findByTestId('meeting-send-review');
    await waitFor(() => expect(review).toBeDisabled());
  });

  it('(c) the review dialog is unskippable: full details appear only in the dialog', async () => {
    renderPanel();
    const review = await screen.findByTestId('meeting-send-review');
    await waitFor(() => expect(review).toBeEnabled());
    // No confirm body before clicking Review send.
    expect(screen.queryByTestId('meeting-send-confirm-body')).not.toBeInTheDocument();
    fireEvent.click(review);
    const confirm = await screen.findByTestId('meeting-send-confirm-body');
    expect(within(confirm).getByText(/^To:/)).toBeInTheDocument();
    expect(within(confirm).getByText(/^Subject:/)).toBeInTheDocument();
  });

  it('(d) recipient plan changes persist without a separate Save button', async () => {
    const ws = makeWorkspace();
    const onChanged = vi.fn();
    renderPanel({ ws, onChanged });
    // add a manual person to the person-first matrix
    fireEvent.change(await screen.findByTestId('meeting-recipient-input-person'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.click(screen.getByTestId('meeting-recipient-add-person'));
    // auto-save persists to meeting.json and notifies the parent
    await waitFor(() => expect(ws.writeFile).toHaveBeenCalled());
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const disk = JSON.parse(ws.files.get('/client/Meetings/one/meeting.json') ?? '{}') as MeetingMeta;
    const summaryEmails = (disk.deliveryPlan?.artifacts.summary ?? []).map((r) => r.email);
    expect(summaryEmails).toContain('new@example.com');
  });

  it('shows the privacy trust note at the action point', async () => {
    renderPanel();
    expect(await screen.findByTestId('meeting-send-trust-note')).toHaveTextContent(
      'Review first. Sends by your email. Lantern never receives files.',
    );
  });
});
