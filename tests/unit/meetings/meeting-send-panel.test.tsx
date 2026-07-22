import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { brandText } from '@/config/brandText';
import { MeetingSendPanel } from '@/features/meetings/MeetingSendPanel';
import { emptyMeetingRecipientArtifacts, type MeetingDeliveryPlan } from '@/features/meetings/meetingRecipientPlan';
import type { MeetingMeta } from '@/features/meetings/meetingStore';
import type { Matter } from '@/platform/types/matter';

const { sendArtifactsMock, requireFileAccessMock } = vi.hoisted(() => ({
  sendArtifactsMock: vi.fn(),
  requireFileAccessMock: vi.fn<() => Promise<void>>(),
}));

vi.mock('@/features/meetings/meetingFileVisibility', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('@/features/meetings/meetingFileVisibility')
  >();
  return {
    ...original,
    requireCurrentMeetingFileAccess: requireFileAccessMock,
  };
});

vi.mock('@/features/meetings/meetingArtifactDelivery', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('@/features/meetings/meetingArtifactDelivery')
  >();
  return { ...original, sendMeetingArtifacts: sendArtifactsMock };
});

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

function unreviewedMeta(): MeetingMeta {
  // exactOptionalPropertyTypes forbids an explicit `reviewedAt: undefined`
  // override; an unreviewed meeting simply OMITS the field.
  const { reviewedAt: _reviewed, ...rest } = meta();
  void _reviewed;
  return rest as MeetingMeta;
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

function renderPanel(opts: { inputMeta?: MeetingMeta; ws?: ReturnType<typeof makeWorkspace>; onChanged?: () => void; matter?: Matter | null } = {}) {
  const ws = opts.ws ?? makeWorkspace();
  const onChanged = opts.onChanged ?? vi.fn();
  const utils = render(
    <MeetingSendPanel
      matterId="matter-1"
      meetingDir="/client/Meetings/one"
      workspaceRoot="/client"
      workspaceGeneration={17}
      visibilityIdentity="test-viewer-and-policy"
      meta={opts.inputMeta ?? meta()}
      matter={opts.matter ?? null}
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
    sendArtifactsMock.mockResolvedValue([]);
    requireFileAccessMock.mockResolvedValue();
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
    renderPanel({ inputMeta: unreviewedMeta() });
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
      brandText('Review first. Sends by your email. Lantern never receives files.'),
    );
  });

  it('shows a calm stop and forwards the live workspace generation when access is revoked during send', async () => {
    sendArtifactsMock.mockRejectedValue(
      new Error('Access to this meeting file changed. Nothing was sent or opened.')
    );
    renderPanel();

    const review = await screen.findByTestId('meeting-send-review');
    await waitFor(() => expect(review).toBeEnabled());
    fireEvent.click(review);
    fireEvent.click(await screen.findByTestId('meeting-send-confirm'));

    await waitFor(() =>
      expect(screen.getAllByText(/Access to this meeting file changed/).length).toBeGreaterThan(0)
    );
    expect(sendArtifactsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceRoot: '/client',
        workspaceGeneration: 17,
      })
    );
  });

  it('(finding 1) serializes recipient saves: an in-flight debounced save never runs concurrently with the flush and disk converges to the latest edit', async () => {
    vi.useFakeTimers();
    try {
      const files = new Map<string, string>();
      files.set('/client/Meetings/one/meeting.json', JSON.stringify(meta()));
      let inFlight = 0;
      let maxInFlight = 0;
      let releaseFirstWrite: () => void = () => {};
      const firstWriteGate = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
      let writeCount = 0;
      const writtenSummaryEmails: string[][] = [];
      const ws = {
        files,
        readFile: vi.fn(async (path: string) => files.get(path) ?? ''),
        writeFile: vi.fn(async (path: string, content: string) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          writeCount += 1;
          if (writeCount === 1) await firstWriteGate; // hold the first (debounced) write open
          files.set(path, content);
          const parsed = JSON.parse(content) as MeetingMeta;
          writtenSummaryEmails.push((parsed.deliveryPlan?.artifacts.summary ?? []).map((r) => r.email));
          inFlight -= 1;
        }),
        readFileBinary: vi.fn(),
        exists: vi.fn(async () => false),
      };
      const onChanged = vi.fn();
      renderPanel({ ws: ws as never, onChanged });

      // Add person A, then let the 600ms autosave debounce fire — its save is
      // now in flight, blocked on the gate.
      fireEvent.change(screen.getByTestId('meeting-recipient-input-person'), { target: { value: 'a@example.com' } });
      fireEvent.click(screen.getByTestId('meeting-recipient-add-person'));
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(ws.writeFile).toHaveBeenCalledTimes(1);
      expect(inFlight).toBe(1);

      // Add person B while the first save is still blocked, then trigger the
      // flush by clicking Review send.
      fireEvent.change(screen.getByTestId('meeting-recipient-input-person'), { target: { value: 'b@example.com' } });
      fireEvent.click(screen.getByTestId('meeting-recipient-add-person'));
      fireEvent.click(screen.getByTestId('meeting-send-review'));

      // Release the in-flight save; the serialized loop then persists the newer
      // {A,B} plan. No two writes ever ran at once.
      await act(async () => {
        releaseFirstWrite();
        await vi.advanceTimersByTimeAsync(600);
      });
      await vi.waitFor(() => expect(screen.getByTestId('meeting-send-confirm-body')).toBeInTheDocument());

      expect(maxInFlight).toBe(1);
      const finalDisk = JSON.parse(files.get('/client/Meetings/one/meeting.json') ?? '{}') as MeetingMeta;
      const finalEmails = (finalDisk.deliveryPlan?.artifacts.summary ?? []).map((r) => r.email);
      expect(finalEmails).toEqual(expect.arrayContaining(['a@example.com', 'b@example.com']));
      // Writes are monotonic: no later write drops a recipient an earlier one had.
      const last = writtenSummaryEmails.at(-1) ?? [];
      expect(last).toEqual(expect.arrayContaining(['a@example.com', 'b@example.com']));
    } finally {
      vi.useRealTimers();
    }
  });

  it('(finding 1, unmount edge) persists the last recipient edit when the drawer closes within the debounce window', async () => {
    const files = new Map<string, string>();
    files.set('/client/Meetings/one/meeting.json', JSON.stringify(meta()));
    const ws = {
      files,
      readFile: vi.fn(async (path: string) => files.get(path) ?? ''),
      writeFile: vi.fn(async (path: string, content: string) => { files.set(path, content); }),
      readFileBinary: vi.fn(),
      exists: vi.fn(async () => false),
    };
    const { unmount } = renderPanel({ ws: ws as never });

    // Edit a recipient, then close the drawer (unmount) BEFORE the 600ms
    // autosave debounce fires.
    fireEvent.change(screen.getByTestId('meeting-recipient-input-person'), { target: { value: 'late@example.com' } });
    fireEvent.click(screen.getByTestId('meeting-recipient-add-person'));
    expect(ws.writeFile).not.toHaveBeenCalled(); // debounce has not fired yet
    unmount();

    // The unmount flush persists the pending edit rather than dropping it.
    await waitFor(() => {
      const disk = JSON.parse(files.get('/client/Meetings/one/meeting.json') ?? '{}') as MeetingMeta;
      const emails = (disk.deliveryPlan?.artifacts.summary ?? []).map((r) => r.email);
      expect(emails).toContain('late@example.com');
    });
  });

  it('writes nothing when recipient access is revoked after the debounced plan read', async () => {
    vi.useFakeTimers();
    try {
      const ws = makeWorkspace();
      requireFileAccessMock
        .mockResolvedValueOnce()
        .mockRejectedValueOnce(
          new Error('Access to this meeting file changed.')
        );
      renderPanel({ ws });

      fireEvent.change(screen.getByTestId('meeting-recipient-input-person'), {
        target: { value: 'revoked@example.com' },
      });
      fireEvent.click(screen.getByTestId('meeting-recipient-add-person'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(requireFileAccessMock).toHaveBeenCalledTimes(2);
      expect(ws.writeFile).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('writes nothing when a pending unmount flush has already lost access', async () => {
    const ws = makeWorkspace();
    requireFileAccessMock.mockRejectedValue(
      new Error('Access to this meeting file changed.')
    );
    const { unmount } = renderPanel({ ws });

    fireEvent.change(screen.getByTestId('meeting-recipient-input-person'), {
      target: { value: 'revoked-on-close@example.com' },
    });
    fireEvent.click(screen.getByTestId('meeting-recipient-add-person'));
    unmount();

    await waitFor(() => expect(requireFileAccessMock).toHaveBeenCalled());
    expect(ws.writeFile).not.toHaveBeenCalled();
  });

  it('(finding 3) offers known recipients (client emails / matter keys) as one-click suggestions in the add-person flow', async () => {
    const matter = { id: 'matter-1', meetingKeys: ['known@client.com'] } as unknown as Matter;
    renderPanel({ matter });

    const chip = await screen.findByTestId('meeting-recipient-suggestion-known@client.com');
    expect(chip).toBeInTheDocument();
    fireEvent.click(chip);

    // Clicking the suggestion adds them as a person row (all items on) and the
    // chip disappears (now present in the matrix).
    expect(await screen.findByTestId('meeting-recipient-person-row-known@client.com')).toBeInTheDocument();
    expect(screen.getByTestId('meeting-recipient-person-artifact-summary-known@client.com')).toBeChecked();
    expect(screen.queryByTestId('meeting-recipient-suggestion-known@client.com')).not.toBeInTheDocument();
  });
});
