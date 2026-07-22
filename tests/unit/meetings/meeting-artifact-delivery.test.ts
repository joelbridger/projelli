import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildMeetingArtifactAvailability,
  buildMeetingSendPreview,
  MEETING_SEND_REVIEW_AGAIN_MESSAGE,
  MEETING_SEND_NOT_REVIEWED_MESSAGE,
  sendMeetingArtifacts as sendMeetingArtifactsRaw,
  type MeetingSendDeps,
  type MeetingDeliveryStatus,
  type MeetingArtifactAvailability,
  type MeetingSendPreview,
} from '@/features/meetings/meetingArtifactDelivery';
import { emptyMeetingRecipientArtifacts, type MeetingDeliveryPlan } from '@/features/meetings/meetingRecipientPlan';
import type { MeetingMeta } from '@/features/meetings/meetingStore';
import type { AuditService } from '@/platform/audit/AuditService';
import type { ConnectedAccount, MailAttachmentInput } from '@/platform/utils/mail-commands';
import { MeetingFileVisibilityRevokedError } from '@/features/meetings/meetingFileVisibility';

const { requireAccessMock } = vi.hoisted(() => ({
  requireAccessMock: vi.fn<(input: { path: string }) => Promise<void>>(),
}));

vi.mock('@/features/meetings/meetingFileVisibility', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('@/features/meetings/meetingFileVisibility')
  >();
  return {
    ...original,
    requireCurrentMeetingFileAccess: requireAccessMock,
  };
});

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

function sendMeetingArtifacts(
  deps: Omit<MeetingSendDeps, 'workspaceRoot' | 'workspaceGeneration'>
) {
  return sendMeetingArtifactsRaw({
    ...deps,
    workspaceRoot: '/client',
    workspaceGeneration: 1,
  });
}

type TestMailSend = (
  provider: string,
  account: string,
  to: string[],
  cc: string[],
  bcc: string[],
  subject: string,
  body: string,
  inReplyToId?: string,
  attachments?: MailAttachmentInput[],
) => Promise<string>;
type TestAuditLogDurable = Pick<AuditService, 'logDurable'>['logDurable'];

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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

beforeEach(() => {
  requireAccessMock.mockReset().mockResolvedValue(undefined);
});

const fullAvailability: MeetingArtifactAvailability = buildMeetingArtifactAvailability({
  hasAudio: true,
  hasTranscript: false,
  hasNotes: true,
  summaryReady: true,
});

function previewFor(inputMeta: MeetingMeta, availability = fullAvailability): MeetingSendPreview {
  return buildMeetingSendPreview({
    meta: inputMeta,
    availability,
    title: 'Annual review',
    clientName: 'Hendricks',
    t: t as never,
  });
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

    expect(preview.items.map((item) => item.artifact)).toEqual(['notes', 'summary']);
    expect(preview.missing).toEqual(['audio']);
    expect(preview.items[0]).toMatchObject({
      artifactLabel: 'Notes',
      attachmentName: 'Annual review notes.docx',
      subject: 'Hendricks meeting Notes: Annual review',
      recipients: [{ email: 'client@example.com', name: 'Client', source: 'manual' }],
    });
  });

  it('prefills the send preview from calendar attendees when no plan was saved', () => {
    const inputMeta = meta({
      calendarEvent: {
        id: 'event-1',
        title: 'Annual review',
        startUtc: NOW,
        endUtc: '2026-07-07T13:00:00.000Z',
        attendees: [
          { email: 'alex@example.com', name: 'Alex' },
          { email: 'sam@example.com', name: 'Sam' },
        ],
      },
    });
    delete inputMeta.deliveryPlan;

    const preview = buildMeetingSendPreview({
      meta: inputMeta,
      availability: buildMeetingArtifactAvailability({
        hasAudio: true,
        hasTranscript: true,
        hasNotes: true,
        summaryReady: true,
      }),
      title: 'Annual review',
      clientName: 'Hendricks',
      t: t as never,
    });

    expect(preview.items.map((item) => item.artifact)).toEqual(['notes', 'transcript', 'summary', 'audio']);
    expect(preview.items[0]?.recipients).toEqual([
      { email: 'alex@example.com', name: 'Alex', source: 'calendar' },
      { email: 'sam@example.com', name: 'Sam', source: 'calendar' },
    ]);
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
    const sendMail = vi.fn<TestMailSend>(async () => 'provider-message-1');
    const audit = {
      logDurable: vi.fn<TestAuditLogDurable>(
        async () => ({ id: 'audit-1' }) as Awaited<ReturnType<TestAuditLogDurable>>,
      ),
    };

    const entries = await sendMeetingArtifacts({
      workspaceService: ws,
      meetingDir: '/client/Meetings/one',
      matterId: 'matter-1',
      meta: original,
      account,
      preview,
      availability: buildMeetingArtifactAvailability({
        hasAudio: true,
        hasTranscript: false,
        hasNotes: true,
        summaryReady: true,
      }),
      clientName: 'Hendricks',
      t: t as never,
      transcriptText: '',
      buildSummaryDocxBytes: async () => new Uint8Array([7, 8, 9]),
      audit: audit as never,
      sendMail: sendMail as never,
      nowIso: NOW,
      idFactory: () => `send-${String(sendMail.mock.calls.length + 1)}`,
    });

    expect(entries).toHaveLength(3);
    expect(sendMail).toHaveBeenCalledTimes(3);
    const firstSendCall = sendMail.mock.calls[0];
    expect(firstSendCall).toBeDefined();
    if (!firstSendCall) throw new Error('Expected the first email send call.');
    expect(firstSendCall[0]).toBe('m365');
    expect(firstSendCall[2]).toEqual(['client@example.com']);
    expect(firstSendCall[7]).toBeUndefined();
    expect(firstSendCall[8]?.[0]).toMatchObject({
      name: 'Annual review notes.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    const written = JSON.parse(String(files.get('/client/Meetings/one/meeting.json'))) as MeetingMeta & {
      deliveryStatus: MeetingDeliveryStatus;
    };
    expect(written.deliveryStatus.sendLog.map((entry) => ({
      artifact: entry.artifact,
      status: entry.status,
      recipients: entry.recipients,
    }))).toEqual([
      { artifact: 'notes', status: 'sent', recipients: [{ email: 'client@example.com', name: 'Client', source: 'manual' }] },
      { artifact: 'summary', status: 'sent', recipients: [{ email: 'client@example.com', name: 'Client', source: 'manual' }] },
      { artifact: 'audio', status: 'sent', recipients: [{ email: 'ops@example.com', source: 'manual' }] },
    ]);

    expect(audit.logDurable).toHaveBeenCalledTimes(3);
    const firstAuditCall = audit.logDurable.mock.calls[0];
    expect(firstAuditCall).toBeDefined();
    if (!firstAuditCall) throw new Error('Expected the first audit log call.');
    expect(firstAuditCall[0]).toBe('email.send');
    const firstAuditOptions = firstAuditCall[2];
    expect(firstAuditOptions).toBeDefined();
    if (!firstAuditOptions) throw new Error('Expected the first audit log options.');
    expect(firstAuditOptions.metadata).toMatchObject({
      matterId: 'matter-1',
      meetingDir: '/client/Meetings/one',
      mailProvider: 'm365',
      recipientCount: 1,
    });
    expect(JSON.stringify(firstAuditOptions.metadata)).not.toContain('client@example.com');
  });

  it('stops before e-mail when exact-file access is revoked while an attachment is being built', async () => {
    const original = meta({
      deliveryPlan: {
        version: 1,
        updatedAt: NOW,
        artifacts: {
          ...emptyMeetingRecipientArtifacts(),
          summary: [
            { email: 'client@example.com', name: 'Client', source: 'manual' },
          ],
        },
      },
    });
    const { ws } = makeWs(original);
    const availability = buildMeetingArtifactAvailability({
      hasAudio: false,
      hasTranscript: false,
      hasNotes: true,
      summaryReady: true,
    });
    const preview = buildMeetingSendPreview({
      meta: original,
      availability,
      title: 'Annual review',
      clientName: 'Hendricks',
      t: t as never,
    });
    const attachment = deferred<Uint8Array>();
    const attachmentStarted = deferred<void>();
    let revoked = false;
    requireAccessMock.mockImplementation(async () => {
      if (revoked) throw new MeetingFileVisibilityRevokedError();
    });
    const sendMail = vi.fn<TestMailSend>(async () => 'must-not-send');

    const pending = sendMeetingArtifacts({
      workspaceService: ws,
      meetingDir: '/client/Meetings/one',
      matterId: 'matter-1',
      meta: original,
      account,
      preview,
      availability,
      clientName: 'Hendricks',
      t: t as never,
      buildSummaryDocxBytes: async () => {
        attachmentStarted.resolve();
        return attachment.promise;
      },
      audit: { logDurable: vi.fn() } as never,
      sendMail: sendMail as never,
    });

    await attachmentStarted.promise;
    revoked = true;
    attachment.resolve(new Uint8Array([7, 8, 9]));

    await expect(pending).rejects.toBeInstanceOf(
      MeetingFileVisibilityRevokedError
    );
    expect(sendMail).not.toHaveBeenCalled();
    expect(requireAccessMock.mock.calls.map(([input]) => input.path)).toContain(
      '/client/Meetings/one/notes.docx'
    );
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
      availability: buildMeetingArtifactAvailability({
        hasAudio: true,
        hasTranscript: false,
        hasNotes: false,
        summaryReady: false,
      }),
      clientName: 'Hendricks',
      t: t as never,
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
      availability: buildMeetingArtifactAvailability({
        hasAudio: true,
        hasTranscript: false,
        hasNotes: false,
        summaryReady: false,
      }),
      clientName: 'Hendricks',
      t: t as never,
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

  it('sends the confirmed snapshot when it matches the latest saved plan', async () => {
    const latest = meta({
      deliveryPlan: {
        ...plan(),
        artifacts: {
          ...plan().artifacts,
          notes: [{ email: 'updated@example.com', name: 'Updated Client', source: 'manual' }],
        },
      },
    });
    const { files, ws } = makeWs(latest);
    files.set('/client/Meetings/one/meeting.json', JSON.stringify(latest));
    const sendMail = vi.fn<TestMailSend>(async () => 'provider-message-1');

    await expect(sendMeetingArtifacts({
      workspaceService: ws,
      meetingDir: '/client/Meetings/one',
      matterId: 'matter-1',
      meta: latest,
      account,
      // The confirmed preview reflects the latest saved plan (as the panel
      // always builds it from the same meta it sends).
      preview: previewFor(latest),
      availability: fullAvailability,
      clientName: 'Hendricks',
      t: t as never,
      buildSummaryDocxBytes: async () => new Uint8Array([7, 8, 9]),
      audit: { logDurable: vi.fn() } as never,
      sendMail: sendMail as never,
      nowIso: NOW,
    })).resolves.toHaveLength(3);

    const notesCall = sendMail.mock.calls.find((call) => call[5] === 'Hendricks meeting Notes: Annual review');
    expect(notesCall?.[2]).toEqual(['updated@example.com']);
  });

  it('refuses to send when the title changed after the dialog was confirmed (finding 2)', async () => {
    const opened = meta(); // confirmed with title "Annual review"
    const renamed = meta({ customTitle: 'Renamed review' }); // same plan, new title
    const { files, ws } = makeWs(opened);
    files.set('/client/Meetings/one/meeting.json', JSON.stringify(renamed));
    const sendMail = vi.fn<TestMailSend>(async () => 'provider-message-1');

    await expect(sendMeetingArtifacts({
      workspaceService: ws,
      meetingDir: '/client/Meetings/one',
      matterId: 'matter-1',
      meta: opened,
      account,
      preview: previewFor(opened),
      availability: fullAvailability,
      clientName: 'Hendricks',
      t: t as never,
      buildSummaryDocxBytes: async () => new Uint8Array([7, 8, 9]),
      audit: { logDurable: vi.fn() } as never,
      sendMail: sendMail as never,
      nowIso: NOW,
    })).rejects.toThrow(MEETING_SEND_REVIEW_AGAIN_MESSAGE);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('refuses to send an unreviewed meeting even if the UI gate is bypassed (finding 5)', async () => {
    const unreviewed = unreviewedMeta();
    const { ws } = makeWs(unreviewed);
    const sendMail = vi.fn<TestMailSend>(async () => 'provider-message-1');

    await expect(sendMeetingArtifacts({
      workspaceService: ws,
      meetingDir: '/client/Meetings/one',
      matterId: 'matter-1',
      meta: unreviewed,
      account,
      preview: previewFor(unreviewed),
      availability: fullAvailability,
      clientName: 'Hendricks',
      t: t as never,
      buildSummaryDocxBytes: async () => new Uint8Array([7, 8, 9]),
      audit: { logDurable: vi.fn() } as never,
      sendMail: sendMail as never,
      nowIso: NOW,
    })).rejects.toThrow(MEETING_SEND_NOT_REVIEWED_MESSAGE);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('stops with a plain re-review message when recipients changed since the dialog opened', async () => {
    const opened = meta();
    const latest = meta({
      deliveryPlan: {
        ...plan(),
        artifacts: {
          ...plan().artifacts,
          notes: [{ email: 'changed@example.com', name: 'Changed Client', source: 'manual' }],
        },
      },
    });
    const { files, ws } = makeWs(opened);
    files.set('/client/Meetings/one/meeting.json', JSON.stringify(latest));
    const sendMail = vi.fn();

    await expect(sendMeetingArtifacts({
      workspaceService: ws,
      meetingDir: '/client/Meetings/one',
      matterId: 'matter-1',
      meta: opened,
      account,
      preview: previewFor(opened),
      availability: fullAvailability,
      clientName: 'Hendricks',
      t: t as never,
      audit: { logDurable: vi.fn() } as never,
      sendMail: sendMail as never,
    })).rejects.toThrow(MEETING_SEND_REVIEW_AGAIN_MESSAGE);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('blocks only artifacts whose attachment exceeds the provider limit before sending', async () => {
    const original = meta();
    const { files, ws } = makeWs(original);
    files.set('/client/Meetings/one/audio.wav', new Uint8Array((3 * 1024 * 1024) + 1).buffer);
    const sendMail = vi.fn(async () => 'provider-message-1');

    const entries = await sendMeetingArtifacts({
      workspaceService: ws,
      meetingDir: '/client/Meetings/one',
      matterId: 'matter-1',
      meta: original,
      account,
      preview: previewFor(original),
      availability: fullAvailability,
      clientName: 'Hendricks',
      t: t as never,
      buildSummaryDocxBytes: async () => new Uint8Array([7, 8, 9]),
      audit: { logDurable: vi.fn() } as never,
      sendMail: sendMail as never,
      nowIso: NOW,
    });

    expect(entries.map((entry) => ({ artifact: entry.artifact, status: entry.status }))).toEqual([
      { artifact: 'notes', status: 'sent' },
      { artifact: 'summary', status: 'sent' },
      { artifact: 'audio', status: 'failed' },
    ]);
    expect(entries[2]?.error).toContain('Annual review audio.wav');
    expect(entries[2]?.error).toContain('limit 3 MB');
    expect(sendMail).toHaveBeenCalledTimes(2);
  });
});
