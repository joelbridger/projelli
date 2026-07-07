import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MeetingArtifactSendPanel } from '@/features/meetings/MeetingArtifactSendPanel';
import { emptyMeetingRecipientArtifacts, type MeetingDeliveryPlan } from '@/features/meetings/meetingRecipientPlan';
import type { MeetingMeta } from '@/features/meetings/meetingStore';

vi.mock('@/platform/utils/mail-commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/utils/mail-commands')>();
  return {
    ...actual,
    mailConnectedAccounts: vi.fn(async () => [{ provider: 'm365', account: 'default', label: 'Outlook' }]),
  };
});

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

function renderPanel(inputMeta = meta()) {
  return render(
    <MeetingArtifactSendPanel
      matterId="matter-1"
      meetingDir="/client/Meetings/one"
      meta={inputMeta}
      clientName="Hendricks"
      workspaceService={{
        readFile: vi.fn(),
        writeFile: vi.fn(),
        readFileBinary: vi.fn(),
        exists: vi.fn(),
      } as never}
      hasAudio={false}
      hasTranscript={false}
      hasNotes={false}
      summaryReady={true}
      transcript={null}
      buildSummaryDocxBytes={async () => new Uint8Array([1, 2, 3])}
      onSent={vi.fn()}
    />,
  );
}

describe('MeetingArtifactSendPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows each email subject and body in the confirm dialog before sending', async () => {
    renderPanel();

    const review = await screen.findByTestId('meeting-send-review');
    await waitFor(() => expect(review).toBeEnabled());
    fireEvent.click(review);

    const summary = await screen.findByTestId('meeting-send-confirm-summary');
    expect(summary).toHaveTextContent('To: Client <client@example.com>');
    expect(summary).toHaveTextContent('Subject: Hendricks meeting Summary: Annual review');
    expect(summary).toHaveTextContent("Body: Hi, Attached is the Summary from Hendricks's meeting: Annual review.");
    expect(summary).toHaveTextContent('Attachment: Annual review summary.docx');
  });

  it('explicitly warns when an already-sent artifact will be sent again', async () => {
    renderPanel(meta({
      deliveryStatus: {
        version: 1,
        sendLog: [{
          id: 'sent-1',
          sentAt: NOW,
          status: 'sent',
          artifact: 'summary',
          artifactLabel: 'Summary',
          recipients: [{ email: 'client@example.com', name: 'Client', source: 'manual' }],
          attachmentNames: ['Annual review summary.docx'],
          provider: 'm365',
          account: 'default',
        }],
      },
    }));

    const review = await screen.findByTestId('meeting-send-review');
    await waitFor(() => expect(review).toBeEnabled());
    fireEvent.click(review);

    expect(await screen.findByText('Summary was already sent. Confirm you want to send it again.')).toBeInTheDocument();
  });
});
