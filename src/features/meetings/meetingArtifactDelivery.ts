import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type {
  ConnectedAccount,
  MailAttachmentInput,
} from '@/platform/utils/mail-commands';
import { mailSend as defaultMailSend } from '@/platform/utils/mail-commands';
import { validateMailAttachmentsForProvider } from '@/platform/utils/mail-commands';
import type { AuditService } from '@/platform/audit/AuditService';
import {
  isPersistedLocalOnly,
  LocalOnlyExternalError,
} from '@/platform/privacy/localOnlyGuard';
import { meetingDisplayTitle } from './meetingDisplay';
import {
  MEETING_ARTIFACTS,
  normalizeMeetingDeliveryPlan,
  resolveMeetingDeliveryPlan,
  type MeetingArtifact,
  type MeetingRecipient,
} from './meetingRecipientPlan';
import type { MeetingMeta } from './meetingStore';
import {
  MeetingFileVisibilityRevokedError,
  requireCurrentMeetingFileAccess,
} from './meetingFileVisibility';
import type { TFunction } from 'i18next';

export type MeetingSendStatus = 'sent' | 'failed';

export interface MeetingSendLogEntry {
  id: string;
  sentAt: string;
  status: MeetingSendStatus;
  artifact: MeetingArtifact;
  artifactLabel: string;
  recipients: MeetingRecipient[];
  attachmentNames: string[];
  provider: string;
  account: string;
  messageId?: string;
  error?: string;
}

export interface MeetingDeliveryStatus {
  version: 1;
  sendLog: MeetingSendLogEntry[];
}

export type MeetingArtifactAvailability = Record<MeetingArtifact, boolean>;

export interface MeetingSendPreviewItem {
  artifact: MeetingArtifact;
  artifactLabel: string;
  recipients: MeetingRecipient[];
  attachmentName: string;
  subject: string;
  body: string;
}

export interface MeetingSendPreview {
  items: MeetingSendPreviewItem[];
  missing: MeetingArtifact[];
}

export interface MeetingSendDeps {
  workspaceService: Pick<
    WorkspaceService,
    'readFile' | 'writeFile' | 'readFileBinary' | 'exists'
  >;
  meetingDir: string;
  workspaceRoot: string;
  workspaceGeneration: number;
  matterId: string;
  meta: MeetingMeta;
  account: ConnectedAccount;
  preview: MeetingSendPreview;
  availability: MeetingArtifactAvailability;
  clientName: string;
  t: TFunction;
  transcriptText?: string;
  buildSummaryDocxBytes?: () => Promise<Uint8Array>;
  audit: Pick<AuditService, 'logDurable'>;
  sendMail?: typeof defaultMailSend;
  /** Narrow test/integration seam; production uses the live file-authority
   * resolver below. */
  requireFileAccess?: typeof requireCurrentMeetingFileAccess;
  nowIso?: string;
  idFactory?: () => string;
}

const DOCX_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MEETING_SEND_REVIEW_AGAIN_MESSAGE =
  'Recipients changed. Review the send again before emailing.';
export const MEETING_SEND_NOT_REVIEWED_MESSAGE =
  'Mark the meeting reviewed before sending.';

/** A stable signature of a send preview's user-visible facts (per artifact:
 *  the subject, body, attachment name, and recipient set). Two previews with
 *  the same signature would produce byte-identical emails. */
function sendPreviewSignature(preview: MeetingSendPreview): string {
  return JSON.stringify(
    preview.items
      .map((item) => [
        item.artifact,
        item.subject,
        item.body,
        item.attachmentName,
        item.recipients.map((recipient) => recipient.email).sort(),
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  );
}

export function emptyMeetingDeliveryStatus(): MeetingDeliveryStatus {
  return { version: 1, sendLog: [] };
}

export function normalizeMeetingDeliveryStatus(
  status: Partial<MeetingDeliveryStatus> | null | undefined
): MeetingDeliveryStatus {
  return {
    version: 1,
    sendLog: Array.isArray(status?.sendLog)
      ? status.sendLog.filter(isSendLogEntry)
      : [],
  };
}

export function buildMeetingArtifactAvailability(input: {
  hasAudio: boolean;
  hasTranscript: boolean;
  hasNotes: boolean;
  summaryReady: boolean;
}): MeetingArtifactAvailability {
  return {
    audio: input.hasAudio,
    transcript: input.hasTranscript,
    summary: input.summaryReady,
    notes: input.hasNotes,
  };
}

export function buildMeetingSendPreview(input: {
  meta: MeetingMeta;
  availability: MeetingArtifactAvailability;
  title: string;
  clientName: string;
  t: TFunction;
}): MeetingSendPreview {
  const plan = resolveMeetingDeliveryPlan(input.meta);
  const missing: MeetingArtifact[] = [];
  const items: MeetingSendPreviewItem[] = [];

  for (const artifact of MEETING_ARTIFACTS) {
    const recipients = plan.artifacts[artifact];
    if (recipients.length === 0) continue;
    if (!input.availability[artifact]) {
      missing.push(artifact);
      continue;
    }
    const artifactLabel = artifactLabelFor(artifact, input.t);
    const attachmentName = attachmentNameFor(artifact, input.title);
    items.push({
      artifact,
      artifactLabel,
      recipients,
      attachmentName,
      subject: input.t('meetings.entry.send.email-subject', {
        client: input.clientName,
        artifact: artifactLabel,
        title: input.title,
      }),
      body: input.t('meetings.entry.send.email-body', {
        client: input.clientName,
        artifact: artifactLabel,
        title: input.title,
      }),
    });
  }

  return { items, missing };
}

export async function sendMeetingArtifacts(
  deps: MeetingSendDeps
): Promise<MeetingSendLogEntry[]> {
  if (isPersistedLocalOnly()) {
    throw new LocalOnlyExternalError('send meeting artifacts by email');
  }
  if (deps.preview.items.length === 0) return [];

  await requireSendFileAccess(`${deps.meetingDir}/meeting.json`, deps);
  const raw = await deps.workspaceService.readFile(
    `${deps.meetingDir}/meeting.json`
  );
  await requireSendFileAccess(`${deps.meetingDir}/meeting.json`, deps);
  const base = JSON.parse(raw) as MeetingMeta;
  if (base.matterId !== deps.matterId) {
    throw new Error('This meeting belongs to a different client.');
  }
  // Defense in depth: the panel gates Review on meta.reviewedAt, but the sender
  // re-checks the meeting on disk so an unreviewed meeting can never be emailed
  // even if a caller bypasses the UI gate.
  if (!base.reviewedAt) {
    throw new Error(MEETING_SEND_NOT_REVIEWED_MESSAGE);
  }
  const openedPlan = normalizeMeetingDeliveryPlan(deps.meta.deliveryPlan);
  const latestPlan = normalizeMeetingDeliveryPlan(base.deliveryPlan);
  if (!sameRecipientArtifacts(openedPlan.artifacts, latestPlan.artifacts)) {
    throw new Error(MEETING_SEND_REVIEW_AGAIN_MESSAGE);
  }
  // The user confirmed `deps.preview`. Rebuild the preview from the latest saved
  // meeting.json and refuse to send if it differs at all (e.g. the title was
  // renamed between opening the dialog and confirming) — otherwise the user
  // would confirm one email and we would send a different one. We then send the
  // exact confirmed snapshot, never a silently-rebuilt one.
  const freshPreview = buildMeetingSendPreview({
    meta: base,
    availability: deps.availability,
    title: meetingSendTitle(base, deps.t),
    clientName: deps.clientName,
    t: deps.t,
  });
  if (
    sendPreviewSignature(freshPreview) !== sendPreviewSignature(deps.preview)
  ) {
    throw new Error(MEETING_SEND_REVIEW_AGAIN_MESSAGE);
  }
  if (deps.preview.items.length === 0) return [];

  const now = deps.nowIso ?? new Date().toISOString();
  const sendMail = deps.sendMail ?? defaultMailSend;
  const entries: MeetingSendLogEntry[] = [];

  for (const item of deps.preview.items) {
    const id =
      deps.idFactory?.() ??
      `meeting_send_${String(Date.now())}_${Math.random().toString(36).slice(2, 9)}`;
    try {
      const sourcePath = artifactSourcePath(item.artifact, deps.meetingDir);
      await requireSendFileAccess(sourcePath, deps);
      const attachment = await buildAttachment(item, deps);
      // Attachment creation can await disk or document work. Recheck the exact
      // source after that wait and immediately before the e-mail leaves.
      await requireSendFileAccess(sourcePath, deps);
      validateMailAttachmentsForProvider(deps.account.provider, [attachment]);
      const messageId = await sendMail(
        deps.account.provider,
        deps.account.account,
        item.recipients.map((recipient) => recipient.email),
        [],
        [],
        item.subject,
        item.body,
        undefined,
        [attachment]
      );
      const entry: MeetingSendLogEntry = {
        id,
        sentAt: now,
        status: 'sent',
        artifact: item.artifact,
        artifactLabel: item.artifactLabel,
        recipients: item.recipients,
        attachmentNames: [attachment.name],
        provider: deps.account.provider,
        account: deps.account.account,
        ...(messageId ? { messageId } : {}),
      };
      entries.push(entry);
      await logMeetingSendAudit(
        deps.audit,
        entry,
        deps.matterId,
        deps.meetingDir
      );
    } catch (error) {
      if (error instanceof MeetingFileVisibilityRevokedError) throw error;
      const entry: MeetingSendLogEntry = {
        id,
        sentAt: now,
        status: 'failed',
        artifact: item.artifact,
        artifactLabel: item.artifactLabel,
        recipients: item.recipients,
        attachmentNames: [item.attachmentName],
        provider: deps.account.provider,
        account: deps.account.account,
        error: error instanceof Error ? error.message : String(error),
      };
      entries.push(entry);
      await logMeetingSendAudit(
        deps.audit,
        entry,
        deps.matterId,
        deps.meetingDir
      );
    }
  }

  const latestRaw = await deps.workspaceService.readFile(
    `${deps.meetingDir}/meeting.json`
  );
  const latest = JSON.parse(latestRaw) as MeetingMeta;
  if (latest.matterId !== deps.matterId) {
    throw new Error('This meeting belongs to a different client.');
  }
  const deliveryStatus = normalizeMeetingDeliveryStatus(latest.deliveryStatus);
  await deps.workspaceService.writeFile(
    `${deps.meetingDir}/meeting.json`,
    JSON.stringify(
      {
        ...latest,
        deliveryStatus: {
          version: 1,
          sendLog: [...deliveryStatus.sendLog, ...entries],
        },
      },
      null,
      2
    )
  );

  return entries;
}

function requireSendFileAccess(
  path: string,
  deps: MeetingSendDeps
): Promise<void> {
  return (deps.requireFileAccess ?? requireCurrentMeetingFileAccess)({
    path,
    workspace: deps.workspaceService,
    workspaceRoot: deps.workspaceRoot,
    workspaceGeneration: deps.workspaceGeneration,
  });
}

function artifactSourcePath(
  artifact: MeetingArtifact,
  meetingDir: string
): string {
  switch (artifact) {
    case 'audio':
      return `${meetingDir}/audio.wav`;
    case 'notes':
    case 'summary':
      return `${meetingDir}/notes.docx`;
    case 'transcript':
      return `${meetingDir}/transcript.json`;
  }
}

export function artifactLabelFor(
  artifact: MeetingArtifact,
  t: TFunction
): string {
  switch (artifact) {
    case 'notes':
      return t('meetings.entry.recipients.artifacts.notes.label');
    case 'transcript':
      return t('meetings.entry.recipients.artifacts.transcript.label');
    case 'summary':
      return t('meetings.entry.recipients.artifacts.summary.label');
    case 'audio':
      return t('meetings.entry.recipients.artifacts.audio.label');
  }
}

function attachmentNameFor(artifact: MeetingArtifact, title: string): string {
  const stem = sanitizeFileStem(title);
  switch (artifact) {
    case 'audio':
      return `${stem} audio.wav`;
    case 'transcript':
      return `${stem} transcript.txt`;
    case 'summary':
      return `${stem} summary.docx`;
    case 'notes':
      return `${stem} notes.docx`;
  }
}

async function buildAttachment(
  item: MeetingSendPreviewItem,
  deps: MeetingSendDeps
): Promise<MailAttachmentInput> {
  switch (item.artifact) {
    case 'audio':
      return {
        name: item.attachmentName,
        contentType: 'audio/wav',
        contentBase64: arrayBufferToBase64(
          await deps.workspaceService.readFileBinary(
            `${deps.meetingDir}/audio.wav`
          )
        ),
      };
    case 'notes':
      return {
        name: item.attachmentName,
        contentType: DOCX_TYPE,
        contentBase64: arrayBufferToBase64(
          await deps.workspaceService.readFileBinary(
            `${deps.meetingDir}/notes.docx`
          )
        ),
      };
    case 'transcript':
      return {
        name: item.attachmentName,
        contentType: 'text/plain; charset=utf-8',
        contentBase64: textToBase64(
          deps.transcriptText ?? (await readTranscriptText(deps))
        ),
      };
    case 'summary': {
      if (!deps.buildSummaryDocxBytes)
        throw new Error('Summary is not ready yet.');
      return {
        name: item.attachmentName,
        contentType: DOCX_TYPE,
        contentBase64: uint8ToBase64(await deps.buildSummaryDocxBytes()),
      };
    }
  }
}

async function readTranscriptText(deps: MeetingSendDeps): Promise<string> {
  if (await deps.workspaceService.exists(`${deps.meetingDir}/transcript.txt`)) {
    return deps.workspaceService.readFile(`${deps.meetingDir}/transcript.txt`);
  }
  throw new Error('Transcript is not ready yet.');
}

async function logMeetingSendAudit(
  audit: Pick<AuditService, 'logDurable'>,
  entry: MeetingSendLogEntry,
  matterId: string,
  meetingDir: string
): Promise<void> {
  await audit.logDurable(
    'email.send',
    `${entry.status === 'sent' ? 'Sent' : 'Failed to send'} meeting ${entry.artifactLabel.toLowerCase()} (${String(entry.recipients.length)} recipient(s))`,
    {
      userDecision: 'approved',
      outputs: {
        status: entry.status,
        artifact: entry.artifact,
        recipientCount: entry.recipients.length,
        attachmentCount: entry.attachmentNames.length,
      },
      metadata: {
        matterId,
        meetingDir,
        sendLogId: entry.id,
        mailProvider: entry.provider,
        account: entry.account,
        artifact: entry.artifact,
        attachmentNames: entry.attachmentNames,
        recipientCount: entry.recipients.length,
        ...(entry.messageId ? { messageId: entry.messageId } : {}),
        ...(entry.error ? { error: entry.error } : {}),
      },
    }
  );
}

function sameRecipientArtifacts(
  a: Record<MeetingArtifact, MeetingRecipient[]>,
  b: Record<MeetingArtifact, MeetingRecipient[]>
): boolean {
  for (const artifact of MEETING_ARTIFACTS) {
    if (stableRecipientsKey(a[artifact]) !== stableRecipientsKey(b[artifact])) {
      return false;
    }
  }
  return true;
}

function stableRecipientsKey(recipients: MeetingRecipient[]): string {
  return recipients
    .map((recipient) => `${recipient.email}\u0000${recipient.name ?? ''}`)
    .sort()
    .join('\u0001');
}

function sanitizeFileStem(value: string): string {
  return (
    value
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .slice(0, 80)
      .replace(/[.\s-]+$/g, '') || 'meeting'
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return uint8ToBase64(new Uint8Array(buffer));
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary);
}

function textToBase64(text: string): string {
  return uint8ToBase64(new TextEncoder().encode(text));
}

function isSendLogEntry(value: unknown): value is MeetingSendLogEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<MeetingSendLogEntry>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.sentAt === 'string' &&
    (entry.status === 'sent' || entry.status === 'failed') &&
    typeof entry.artifact === 'string' &&
    Array.isArray(entry.recipients) &&
    Array.isArray(entry.attachmentNames) &&
    typeof entry.provider === 'string' &&
    typeof entry.account === 'string'
  );
}

export function meetingSendLogSummary(
  meta: MeetingMeta | null
): MeetingSendLogEntry[] {
  return normalizeMeetingDeliveryStatus(meta?.deliveryStatus).sendLog;
}

export function meetingSendTitle(
  meta: MeetingMeta | null,
  t: TFunction
): string {
  return meetingDisplayTitle(meta, t);
}
