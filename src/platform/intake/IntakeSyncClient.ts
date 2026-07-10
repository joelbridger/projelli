import {
  importContentKey,
  openItemChunk,
  openManifest,
  unwrapContentKey,
  verifySubmissionIntegrity,
  type SealedManifest,
} from '@/platform/intake/intakeCrypto';
import type { ChunkUpload } from './intakeContract';

export interface IntakeInboxSubmission {
  cursor: number;
  intake_id: string;
  item_id: string;
  submission_id: string;
  submitted_at: string;
  manifest_ciphertext_b64: string;
  wrapped_content_key_b64: string;
  chunks: ChunkUpload[];
  session_id?: string;
}

export interface IntakeInboxPage {
  cursor: number;
  has_more: boolean;
  submissions: IntakeInboxSubmission[];
}

export interface IntakeRelayInboxClient {
  fetchInbox(sinceCursor: number): Promise<IntakeInboxPage>;
  ackSubmission(intakeId: string, submissionId: string, cursor: number): Promise<void>;
}

export type IntakeSubmissionFlagKind = 'integrity_mismatch' | 'duplicate' | 'new_device';

export interface IntakeSubmissionFlag {
  kind: IntakeSubmissionFlagKind;
  intakeId: string;
  itemId: string;
  submissionId: string;
  reason: string;
  at: string;
}

export interface RoutedIntakeSubmission {
  intakeId: string;
  itemId: string;
  submissionId: string;
  submittedAt: string;
  manifest: SealedManifest;
  plaintextBytes: Uint8Array[];
  sessionId?: string;
}

export interface IntakeRouteResult {
  factId?: string;
  filePath?: string;
}

export interface IntakeSyncClientOptions {
  relay: IntakeRelayInboxClient;
  loadPrivateKey: (intakeId: string) => Promise<CryptoKey>;
  hasSubmission: (submissionId: string) => Promise<boolean>;
  rememberSubmission: (submissionId: string) => Promise<void>;
  isKnownSession: (intakeId: string, sessionId: string) => Promise<boolean>;
  rememberSession: (intakeId: string, sessionId: string) => Promise<void>;
  flagSubmission: (flag: IntakeSubmissionFlag) => Promise<void>;
  routeSubmission: (submission: RoutedIntakeSubmission) => Promise<IntakeRouteResult>;
  initialCursor?: number;
}

export interface IntakeSyncResult {
  pulled: number;
  routed: number;
  acked: number;
  duplicates: number;
  rejected: number;
  cursor: number;
}

type IntakeProcessSubmissionResult = Omit<IntakeSyncResult, 'pulled' | 'cursor'> & {
  ackedCursor?: number;
};

function flagFromSubmission(
  submission: IntakeInboxSubmission,
  kind: IntakeSubmissionFlagKind,
  reason: string,
): IntakeSubmissionFlag {
  return {
    kind,
    reason,
    intakeId: submission.intake_id,
    itemId: submission.item_id,
    submissionId: submission.submission_id,
    at: new Date().toISOString(),
  };
}

export class IntakeSyncClient {
  private cursor: number;
  private readonly relay: IntakeRelayInboxClient;
  private readonly loadPrivateKey: IntakeSyncClientOptions['loadPrivateKey'];
  private readonly hasSubmission: IntakeSyncClientOptions['hasSubmission'];
  private readonly rememberSubmission: IntakeSyncClientOptions['rememberSubmission'];
  private readonly isKnownSession: IntakeSyncClientOptions['isKnownSession'];
  private readonly rememberSession: IntakeSyncClientOptions['rememberSession'];
  private readonly flagSubmission: IntakeSyncClientOptions['flagSubmission'];
  private readonly routeSubmission: IntakeSyncClientOptions['routeSubmission'];

  constructor(options: IntakeSyncClientOptions) {
    this.cursor = options.initialCursor ?? 0;
    this.relay = options.relay;
    this.loadPrivateKey = options.loadPrivateKey;
    this.hasSubmission = options.hasSubmission;
    this.rememberSubmission = options.rememberSubmission;
    this.isKnownSession = options.isKnownSession;
    this.rememberSession = options.rememberSession;
    this.flagSubmission = options.flagSubmission;
    this.routeSubmission = options.routeSubmission;
  }

  getCursor(): number {
    return this.cursor;
  }

  async syncOnce(): Promise<IntakeSyncResult> {
    const totals: IntakeSyncResult = {
      pulled: 0,
      routed: 0,
      acked: 0,
      duplicates: 0,
      rejected: 0,
      cursor: this.cursor,
    };

    for (;;) {
      const page = await this.relay.fetchInbox(this.cursor);
      totals.pulled += page.submissions.length;
      for (const submission of page.submissions) {
        const result = await this.processSubmission(submission);
        totals.routed += result.routed;
        totals.acked += result.acked;
        totals.duplicates += result.duplicates;
        totals.rejected += result.rejected;
        if (result.ackedCursor == null) {
          totals.cursor = this.cursor;
          return totals;
        }
        this.cursor = Math.max(this.cursor, result.ackedCursor);
        totals.cursor = this.cursor;
      }
      totals.cursor = this.cursor;
      if (!page.has_more) break;
    }
    return totals;
  }

  private async processSubmission(
    submission: IntakeInboxSubmission,
  ): Promise<IntakeProcessSubmissionResult> {
    const totals = { routed: 0, acked: 0, duplicates: 0, rejected: 0 };
    const sessionId = submission.session_id;
    if (sessionId && !(await this.isKnownSession(submission.intake_id, sessionId))) {
      await this.flagSubmission(flagFromSubmission(submission, 'new_device', 'Submission came from a new device.'));
    }

    let routed: RoutedIntakeSubmission;
    try {
      routed = await this.decryptAndVerify(submission);
    } catch (error) {
      await this.flagSubmission(
        flagFromSubmission(
          submission,
          'integrity_mismatch',
          error instanceof Error ? error.message : 'Submission failed integrity checks.',
        ),
      );
      totals.rejected += 1;
      return totals;
    }

    if (await this.hasSubmission(routed.manifest.submission_id)) {
      await this.flagSubmission(flagFromSubmission(submission, 'duplicate', 'Submission was already filed locally.'));
      await this.relay.ackSubmission(submission.intake_id, submission.submission_id, submission.cursor);
      totals.duplicates += 1;
      totals.acked += 1;
      return { ...totals, ackedCursor: submission.cursor };
    }

    try {
      await this.routeSubmission(routed);
      await this.rememberSubmission(routed.manifest.submission_id);
      if (sessionId) await this.rememberSession(submission.intake_id, sessionId);
      await this.relay.ackSubmission(submission.intake_id, submission.submission_id, submission.cursor);
    } catch {
      return totals;
    }
    totals.routed += 1;
    totals.acked += 1;
    return { ...totals, ackedCursor: submission.cursor };
  }

  private async decryptAndVerify(submission: IntakeInboxSubmission): Promise<RoutedIntakeSubmission> {
    const privateKey = await this.loadPrivateKey(submission.intake_id);
    const contentKeyB64 = await unwrapContentKey(submission.wrapped_content_key_b64, privateKey);
    const contentKey = await importContentKey(contentKeyB64);
    const ids = {
      intakeId: submission.intake_id,
      itemId: submission.item_id,
      submissionId: submission.submission_id,
    };
    const openedManifest = await openManifest(contentKey, submission.manifest_ciphertext_b64, ids);
    if (!openedManifest.ok) {
      throw new Error(`Manifest failed integrity checks: ${openedManifest.reason}.`);
    }

    const plaintextBytes: Uint8Array[] = [];
    const chunkAADSids: string[] = [];
    for (const chunk of submission.chunks) {
      const opened = await openItemChunk(contentKey, chunk.ciphertext_b64, {
        intakeId: chunk.intake_id,
        itemId: chunk.item_id,
        submissionId: chunk.submission_id,
        index: chunk.index,
      });
      if (!opened.ok) throw new Error(`Chunk ${String(chunk.index)} failed integrity checks: ${opened.reason}.`);
      plaintextBytes.push(opened.data);
      chunkAADSids.push(chunk.submission_id);
    }

    const verified = verifySubmissionIntegrity(submission.submission_id, openedManifest.manifest, chunkAADSids);
    if (!verified.ok) throw new Error(`Submission integrity mismatch: ${verified.reason}.`);

    return {
      intakeId: submission.intake_id,
      itemId: submission.item_id,
      submissionId: submission.submission_id,
      submittedAt: submission.submitted_at,
      manifest: openedManifest.manifest,
      plaintextBytes,
      ...(submission.session_id ? { sessionId: submission.session_id } : {}),
    };
  }
}
