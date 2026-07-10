import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';

import { useFirmStore } from '@/platform/firm/firmStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { IntakeRelayClient } from './IntakeRelayClient';
import {
  IntakeSyncClient,
  type IntakeInboxPage,
  type IntakeRelayInboxClient,
  type IntakeRouteResult,
  type IntakeSubmissionFlag,
  type RoutedIntakeSubmission,
} from './IntakeSyncClient';
import { loadIntakePrivateKey } from './intakeKeychain';
import { fileIntakeDocument } from './intakeFiling';
import {
  intakeFactUpsert,
  type IntakeFactUpsertInput,
  type MaskedClientFact,
} from './factsStore';
import {
  FACT_KIND_SENSITIVITY,
  type FactKind,
  type FactValue,
} from './types';
import {
  useIntakeStore,
  type IntakeChecklistState,
  type IntakeFlag,
  type IntakeRecord,
} from './intakeStore';

const DEFAULT_SYNC_INTERVAL_MS = 30_000;

interface IntakeRelayInboxMethodClient {
  fetchInbox(intakeId: string, sinceCursor: number): Promise<IntakeInboxPage>;
  ackSubmission(intakeId: string, submissionId: string, cursor: number): Promise<void>;
}

type UpsertFact = (input: IntakeFactUpsertInput) => Promise<MaskedClientFact>;
type FileDocument = typeof fileIntakeDocument;

export interface RouteIntakeSubmissionOptions {
  intake: IntakeRecord;
  matterFolderPath: string;
  workspaceService: WorkspaceService | null;
  upsertFact?: UpsertFact;
  fileDocument?: FileDocument;
}

export function bindIntakeRelayInbox(
  relay: IntakeRelayInboxMethodClient,
  intakeId: string,
): IntakeRelayInboxClient {
  return {
    fetchInbox: (sinceCursor) => relay.fetchInbox(intakeId, sinceCursor),
    ackSubmission: (_intakeId, submissionId, cursor) =>
      relay.ackSubmission(intakeId, submissionId, cursor),
  };
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function decodeJsonSubmission(submission: RoutedIntakeSubmission): unknown {
  const bytes = concatBytes(submission.plaintextBytes);
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null;
}

function isFactKind(value: unknown): value is FactKind {
  return typeof value === 'string' && value in FACT_KIND_SENSITIVITY;
}

function factKindForSubmission(
  body: Record<string, unknown>,
  submission: RoutedIntakeSubmission,
): FactKind | null {
  if (isFactKind(body['fact_kind'])) return body['fact_kind'];
  const itemId = typeof body['item_id'] === 'string' ? body['item_id'] : submission.itemId;
  if (isFactKind(itemId)) return itemId;
  if (itemId === 'income') return 'income_annual';
  if (itemId === 'spending') return 'spending_monthly';
  if (itemId === 'license') return 'drivers_license';
  return null;
}

function factValue(kind: FactKind, raw: unknown): FactValue {
  if (kind === 'dob') return { t: 'date', v: String(raw) };
  if ((kind === 'income_annual' || kind === 'spending_monthly') && typeof raw === 'number') {
    return { t: 'money', v: { amount: raw, currency: 'USD' } };
  }
  return { t: 'string', v: String(raw) };
}

function currentChecklistItem(
  intake: IntakeRecord,
  itemId: string,
): IntakeChecklistState {
  return intake.items.find((item) => item.itemId === itemId) ?? {
    itemId,
    label: itemId,
    state: 'not_started',
  };
}

async function routeJsonSubmission(
  submission: RoutedIntakeSubmission,
  options: RouteIntakeSubmissionOptions,
): Promise<IntakeRouteResult> {
  const body = objectRecord(decodeJsonSubmission(submission));
  if (!body || !('value' in body)) return {};
  const kind = factKindForSubmission(body, submission);
  if (!kind) return {};
  const subject = typeof body['subject'] === 'string' && body['subject'].trim()
    ? body['subject'].trim()
    : 'primary';
  const fact = await (options.upsertFact ?? intakeFactUpsert)({
    matter_id: options.intake.matterId,
    subject,
    kind,
    value: factValue(kind, body['value']),
    sensitivity: FACT_KIND_SENSITIVITY[kind],
    provenance: {
      channel: 'intake_link',
      entered_by: 'client',
      at: submission.submittedAt,
    },
    verification: 'client_stated',
  });
  return { factId: fact.fact_id };
}

async function routeFileSubmission(
  submission: RoutedIntakeSubmission,
  options: RouteIntakeSubmissionOptions,
): Promise<IntakeRouteResult> {
  if (!options.workspaceService) {
    throw new Error('A workspace must be open before intake documents can be filed.');
  }
  const item = currentChecklistItem(options.intake, submission.itemId);
  const fileName = submission.manifest.file_names[0] ?? `${item.label}.bin`;
  const filePath = await (options.fileDocument ?? fileIntakeDocument)({
    workspaceService: options.workspaceService,
    matterFolderPath: options.matterFolderPath,
    fileName,
    bytes: concatBytes(submission.plaintextBytes),
  });
  return { filePath };
}

function markSubmissionReceived(
  submission: RoutedIntakeSubmission,
  intake: IntakeRecord,
  result: IntakeRouteResult,
): void {
  const item = currentChecklistItem(intake, submission.itemId);
  const provenance = {
    channel: 'intake_link' as const,
    label: 'provided by client',
    at: submission.submittedAt,
  };
  const store = useIntakeStore.getState();
  store.updateItem(submission.intakeId, {
    ...item,
    state: 'received',
    provenance,
    ...(result.factId ? { factId: result.factId } : {}),
    ...(result.filePath ? { filePath: result.filePath } : {}),
  });
  store.addReceivedItem(submission.intakeId, {
    itemId: item.itemId,
    label: item.label,
    receivedAt: submission.submittedAt,
    provenance,
    ...(result.factId ? { factId: result.factId } : {}),
    ...(result.filePath ? { filePath: result.filePath } : {}),
  });
  store.setLastClientActivity(submission.intakeId, submission.submittedAt);
}

export async function routeIntakeSubmission(
  submission: RoutedIntakeSubmission,
  options: RouteIntakeSubmissionOptions,
): Promise<IntakeRouteResult> {
  const result = submission.manifest.content_type === 'application/json'
    ? await routeJsonSubmission(submission, options)
    : await routeFileSubmission(submission, options);
  markSubmissionReceived(submission, options.intake, result);
  return result;
}

function flagToIntakeFlag(flag: IntakeSubmissionFlag): IntakeFlag {
  return {
    id: `submission:${flag.submissionId}:${flag.kind}`,
    kind: flag.kind,
    itemId: flag.itemId,
    submissionId: flag.submissionId,
    message: flag.reason,
    at: flag.at,
  };
}

async function loadRequiredPrivateKey(intakeId: string): Promise<CryptoKey> {
  const privateKey = await loadIntakePrivateKey(intakeId);
  if (!privateKey) {
    throw new Error('This intake is missing its private key.');
  }
  return privateKey;
}

async function syncOneIntake(
  intake: IntakeRecord,
  relayClient: IntakeRelayInboxMethodClient,
  workspaceService: WorkspaceService,
): Promise<void> {
  const syncClient = new IntakeSyncClient({
    relay: bindIntakeRelayInbox(relayClient, intake.intakeId),
    loadPrivateKey: loadRequiredPrivateKey,
    hasSubmission: (submissionId) => Promise.resolve(
      useIntakeStore.getState().intakesById[intake.intakeId]?.knownSubmissionIds.includes(submissionId) ?? false,
    ),
    rememberSubmission: (submissionId) => {
      useIntakeStore.getState().rememberSubmission(intake.intakeId, submissionId);
      return Promise.resolve();
    },
    isKnownSession: (intakeId, sessionId) => Promise.resolve(
      useIntakeStore.getState().intakesById[intakeId]?.knownSessionIds.includes(sessionId) ?? false,
    ),
    rememberSession: (intakeId, sessionId) => {
      useIntakeStore.getState().rememberSession(intakeId, sessionId);
      return Promise.resolve();
    },
    flagSubmission: (flag) => {
      useIntakeStore.getState().addFlag(flag.intakeId, flagToIntakeFlag(flag));
      if (flag.kind === 'duplicate') {
        useIntakeStore.getState().setLastClientActivity(flag.intakeId, flag.at);
      }
      return Promise.resolve();
    },
    routeSubmission: async (submission) => {
      const current = useIntakeStore.getState().intakesById[submission.intakeId];
      if (!current) throw new Error('Intake was removed before the submission could be filed.');
      const matter = useMatterStore.getState().matters.find((candidate) => candidate.id === current.matterId);
      const matterFolderPath = matter?.folderPaths[0];
      if (!matterFolderPath) throw new Error('This client needs a folder before intake documents can be filed.');
      return routeIntakeSubmission(submission, {
        intake: current,
        matterFolderPath,
        workspaceService,
      });
    },
    initialCursor: intake.lastCursor ?? 0,
  });

  const result = await syncClient.syncOnce();
  useIntakeStore.getState().setCursor(intake.intakeId, result.cursor);
}

export async function syncActiveIntakeInboxesOnce(options: {
  relayClient: IntakeRelayInboxMethodClient;
  workspaceService: WorkspaceService;
}): Promise<void> {
  const activeIntakes = Object.values(useIntakeStore.getState().intakesById)
    .filter((intake) => intake.status === 'active');
  for (const intake of activeIntakes) {
    try {
      await syncOneIntake(intake, options.relayClient, options.workspaceService);
    } catch (error) {
      console.warn('[useIntakeInboxSync] Intake inbox sync failed:', error);
    }
  }
}

export function useIntakeInboxSync(options: {
  workspaceService: WorkspaceService | null;
  intervalMs?: number;
}): void {
  const seatToken = useFirmStore((state) => state.seatToken);
  const accessToken = useFirmStore((state) => state.accessToken);
  const intervalMs = options.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS;

  useEffect(() => {
    if (!isTauri() || !seatToken || !options.workspaceService) return undefined;
    let running = false;
    let stopped = false;
    const relayClient = new IntakeRelayClient({ seatToken, accessToken });
    const run = (): void => {
      if (running || stopped || !options.workspaceService) return;
      running = true;
      void syncActiveIntakeInboxesOnce({
        relayClient,
        workspaceService: options.workspaceService,
      })
        .catch((error: unknown) => {
          console.warn('[useIntakeInboxSync] Intake inbox sync failed:', error);
        })
        .finally(() => {
          running = false;
        });
    };

    // LANE0-LIVE-SYNC-MOUNT
    run();
    const intervalId = window.setInterval(run, intervalMs);
    window.addEventListener('focus', run);
    return () => {
      stopped = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', run);
    };
  }, [accessToken, intervalMs, options.workspaceService, seatToken]);
}
