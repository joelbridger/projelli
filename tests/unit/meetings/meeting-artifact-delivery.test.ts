import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildMeetingArtifactAvailability,
  buildMeetingSendPreview,
  sendMeetingArtifacts,
  type MeetingDeliveryStatus,
} from '@/features/meetings/meetingArtifactDelivery';
import { emptyMeetingRecipientArtifacts, type MeetingDeliveryPlan } from '@/features/meetings/meetingRecipientPlan';
import type { MeetingMeta } from '@/features/meetings/meetingStore';
import type { ConnectedAccount } from '@/platform/utils/mail-commands';

vi.mock('@/platform/privacy/localOnlyGuard', () => ({
  isPersistedLocalOnly: vi.fn(() => false),
  LocalOnlyExternalError: class LocalOnlyExternalError extends Error {
    constructor(op: string) {
      super(`Local-only mode is on, so "${op}" can't run.`);
      this.name = 'LocalOnlyExternalError';
    }
  },
}));

const NOW = '2026-07-07T12:00:00.000Z';

const account: ConnectedAccount = {
  provider: 'm365',
  account: 'default',
  label: 'Outlook',
};

function t(key: string, values?: Record<string, unknown>): string {
  const map: Record<string, string> = {
    'meetings.entry.recipients.artifacts.audio.label': 'Audio',
    'meetings.entry.recipients.artifacts.transcript.label': 'Transcript',
    'meetings.entry.recipients.artifacts.summary.label': 'Summary',
    'meetings.entry.recipients.artifacts.notes.label': 'Notes',
    'meetings.entry.send.email-subject': '{{client}} meeting {{artifact}}: {{title}}',
    'meetings.entry.send.email-body': 'Attached is {{artifact}} for {{client}}: {{title}}.',
  };
  return (map[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''));
}

function plan(): MeetingDeliveryPlan {
  return {
    version: 1,
    updatedAt: NOW,
    artifacts: {
      ...emptyMeetingRecipientArtifacts(),
      notes: [{ email: 'client@example.com', name: 'Client', source: 'manual' }],
      summary: [{ email: 'client@example.com', name: 'Client', source: 'manual' }],
      audio: [{ email: 'ops@example.com', source: 'manual' }],
    },
  };
}

function meta(overrides: Partial<MeetingMeta> = {}): MeetingMeta {
  return {
    matterId: 'matter-1',
    startedAt: NOW,
    reviewedAt: NOW,
    consent: { mode: 'one-party', confirmedBy: 'advisor', confirmedAt: NOW },
    deliveryPlan: plan(),
    ...overrides,
  };
}

function makeWs(initial: MeetingMeta) {
  const files = new Map<string, string | ArrayBuffer>();
  files.set('/client/Meetings/one/meeting.json', JSON.stringify(initial));
  files.set('/client/Meetings/one/notes.docx', new Uint8Array([1, 2, 3]).buffer);
  files.set('/client/Meetings/one/audio.wav', new Uint8Array([4, 5, 6]).buffer);
  return {
    files,
    ws: {
      readFile: vi.fn(async (path: string) => {
        const value = files.get(path);
        if (typeof value !== 'string') throw new Error(`missing text ${path}`);
        return value;
      }),
      writeFile: vi.fn(async (path: string, content: string) => {
        files.set(path, content);
      }),
      readFileBinary: vi.fn(async (path: string) => {
        const value = files.get(path);
        if (typeof value === 'string' || value === undefined) throw new Error(`missing binary ${path}`);
        return value;
      }),
      exists: vi.fn(async (path: string) => files.has(path)),
    },
  };
}

describe('meeting artifact delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds a reviewed send preview only for chosen recipients and ready artifacts', () => {
    const preview = buildMeetingSendPreview({
      meta: meta(),
      availability: buildMeetingArtifactAvailability({
        hasAudio: false,
        hasTranscript: true,
        hasNotes: true,
        summaryReady: true,
      }),
      title: 'Annual review',
      clientName: 'Hendricks',
      t: t as never,
    });

    expect(preview.items.map((item) => item.artifact)).toEqual(['summary', 'notes']);
    expect(preview.missing).toEqual(['audio']);
    expect(preview.items[0]).toMatchObject({
      artifactLabel: 'Summary',
      attachmentName: 'Annual review summary.docx',
      subject: 'Hendricks meeting Summary: Annual review',
      recipients: [{ email: 'client@example.com', name: 'Client', source: 'manual' }],
    });
  });

  it('sends every reviewed artifact, writes an exact local send log, and writes privacy-safe audit entries', async () => {
    const original = meta();
    const { files, ws } = makeWs(original);
    const preview = buildMeetingSendPreview({
      meta: original,
      availability: buildMeetingArtifactAvailability({
        hasAudio: true,
        hasTranscript: false,
        hasNotes: true,
        summaryReady: true,
      }),
      title: 'Annual review',
      clientName: 'Hendricks',
      t: t as never,
    });
    const sendMail = vi.fn(async () => 'provider-message-1');
    const audit = { logDurable: vi.fn(async () => ({ id: 'audit-1' })) };

    const entries = await sendMeetingArtifacts({
      workspaceService: ws,
      meetingDir: '/client/Meetings/one',
      matterId: 'matter-1',
      meta: original,
      account,
      preview,
      transcriptText: '',
      buildSummaryDocxBytes: async () => new Uint8Array([7, 8, 9]),
      audit: audit as never,
      sendMail: sendMail as never,
      nowIso: NOW,
      idFactory: () => `send-${String(sendMail.mock.calls.length + 1)}`,
    });

    expect(entries).toHaveLength(3);
    expect(sendMail).toHaveBeenCalledTimes(3);
    expect(sendMail.mock.calls[0][0]).toBe('m365');
    expect(sendMail.mock.calls[0][2]).toEqual(['ops@example.com']);
    expect(sendMail.mock.calls[0][7]).toBeUndefined();
    expect(sendMail.mock.calls[0][8][0]).toMatchObject({
      name: 'Annual review audio.wav',
      contentType: 'audio/wav',
    });

    const written = JSON.parse(String(files.get('/client/Meetings/one/meeting.json'))) as MeetingMeta & {
      deliveryStatus: MeetingDeliveryStatus;
    };
    expect(written.deliveryStatus.sendLog.map((entry) => ({
      artifact: entry.artifact,
      status: entry.status,
      recipients: entry.recipients,
    }))).toEqual([
      { artifact: 'audio', status: 'sent', recipients: [{ email: 'ops@example.com', source: 'manual' }] },
      { artifact: 'summary', status: 'sent', recipients: [{ email: 'client@example.com', name: 'Client', source: 'manual' }] },
      { artifact: 'notes', status: 'sent', recipients: [{ email: 'client@example.com', name: 'Client', source: 'manual' }] },
    ]);

    expect(audit.logDurable).toHaveBeenCalledTimes(3);
    expect(audit.logDurable.mock.calls[0][0]).toBe('email.send');
    expect(audit.logDurable.mock.calls[0][2].metadata).toMatchObject({
      matterId: 'matter-1',
      meetingDir: '/client/Meetings/one',
      mailProvider: 'm365',
      recipientCount: 1,
    });
    expect(JSON.stringify(audit.logDurable.mock.calls[0][2].metadata)).not.toContain('ops@example.com');
  });

  it('refuses to write a send log for a meeting from another client', async () => {
    const original = meta({ matterId: 'matter-2' });
    const { ws } = makeWs(original);
    const preview = buildMeetingSendPreview({
      meta: original,
      availability: buildMeetingArtifactAvailability({
        hasAudio: true,
        hasTranscript: false,
        hasNotes: false,
        summaryReady: false,
      }),
      title: 'Annual review',
      clientName: 'Hendricks',
      t: t as never,
    });

    await expect(sendMeetingArtifacts({
      workspaceService: ws,
      meetingDir: '/client/Meetings/one',
      matterId: 'matter-1',
      meta: original,
      account,
      preview,
      audit: { logDurable: vi.fn() } as never,
      sendMail: vi.fn() as never,
    })).rejects.toThrow('This meeting belongs to a different client.');
  });

  it('writes a failed send log when an attachment is missing at confirm time', async () => {
    const original = meta();
    const { files, ws } = makeWs(original);
    files.delete('/client/Meetings/one/audio.wav');
    const preview = buildMeetingSendPreview({
      meta: original,
      availability: buildMeetingArtifactAvailability({
        hasAudio: true,
        hasTranscript: false,
        hasNotes: false,
        summaryReady: false,
      }),
      title: 'Annual review',
      clientName: 'Hendricks',
      t: t as never,
    });
    const sendMail = vi.fn();
    const audit = { logDurable: vi.fn(async () => ({ id: 'audit-1' })) };

    const entries = await sendMeetingArtifacts({
      workspaceService: ws,
      meetingDir: '/client/Meetings/one',
      matterId: 'matter-1',
      meta: original,
      account,
      preview,
      audit: audit as never,
      sendMail: sendMail as never,
      nowIso: NOW,
      idFactory: () => 'send-missing-audio',
    });

    expect(sendMail).not.toHaveBeenCalled();
    expect(entries).toMatchObject([
      { artifact: 'audio', status: 'failed', attachmentNames: ['Annual review audio.wav'] },
    ]);
    const written = JSON.parse(String(files.get('/client/Meetings/one/meeting.json'))) as MeetingMeta & {
      deliveryStatus: MeetingDeliveryStatus;
    };
    expect(written.deliveryStatus.sendLog[0]).toMatchObject({
      id: 'send-missing-audio',
      status: 'failed',
      artifact: 'audio',
    });
    expect(audit.logDurable).toHaveBeenCalledWith(
      'email.send',
      expect.stringContaining('Failed to send'),
      expect.objectContaining({
        outputs: expect.objectContaining({ status: 'failed', artifact: 'audio' }),
      }),
    );
  });
});
