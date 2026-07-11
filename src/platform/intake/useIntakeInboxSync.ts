import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';

import { useFirmStore } from '@/platform/firm/firmStore';
import { FirmApiClient } from '@/platform/firm/FirmApiClient';
import { getOrCreateDeviceKeypair } from '@/platform/firm/deviceKeys';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { IntakeRelayClient } from './IntakeRelayClient';
import { obtainIntakeKey } from './intakeKeyShare';
import {
  IntakeSyncClient,
  type IntakeInboxPage,
  type IntakeRelayInboxClient,
  type IntakeRouteResult,
  type IntakeSubmissionFlag,
  type RoutedIntakeSubmission,
} from './IntakeSyncClient';
import { loadIntakePrivateKey, loadPdfTemplateDescriptor } from './intakeKeychain';
import { fileIntakeDocument } from './intakeFiling';
import { pdfCompletionReceiptFromManifest, verifyPdfFillReceipt } from './pdfFillReceipt';
import {
  intakeFactUpsert,
  type IntakeFactUpsertInput,
  type MaskedClientFact,
} from './factsStore';
import {
  FACT_KIND_SENSITIVITY,
  type FactKind,
  type FactValue,
  type GuidedQuestionResponseFormat,
  type RequestItem,
} from './types';
import { factKindForPhoneItem } from './phoneWalkthrough';
import {
  useIntakeStore,
  type IntakeChecklistState,
  type IntakeFlag,
  type IntakeRecord,
} from './intakeStore';
import type { Tier1WarningReason } from './documentDetectiveTypes';

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

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function responseFormatForItem(item: RequestItem): GuidedQuestionResponseFormat | null {
  return item.t === 'guided_question' ? item.response_format : null;
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/[$€£¥,\s]/gu, '');
  if (!/^-?(?:\d+|\d*\.\d+)$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  try {
    const json = JSON.stringify(value);
    if (typeof json === 'string') return json;
  } catch {
    return '[unserializable answer]';
  }
  return '[unserializable answer]';
}

function currencyFromRecord(record: Record<string, unknown>): string {
  const currency = record['currency'];
  return typeof currency === 'string' && currency.trim()
    ? currency.trim().toUpperCase()
    : 'USD';
}

function moneyValue(raw: unknown): FactValue | null {
  const directAmount = numberFromUnknown(raw);
  if (directAmount !== null) {
    return { t: 'money', v: { amount: directAmount, currency: 'USD' } };
  }
  const record = objectRecord(raw);
  if (!record) return null;
  const amount = numberFromUnknown(record['amount']);
  if (amount === null) return null;
  return { t: 'money', v: { amount, currency: currencyFromRecord(record) } };
}

function rangeValue(raw: unknown): FactValue | null {
  const record = objectRecord(raw);
  if (!record) return null;
  const min = numberFromUnknown(record['min']);
  const max = numberFromUnknown(record['max']);
  if (min === null && max === null) return null;
  const value: Extract<FactValue, { t: 'range' }>['v'] = {};
  if (min !== null) value.min = min;
  if (max !== null) value.max = max;
  const unit = record['unit'];
  if (typeof unit === 'string' && unit.trim()) value.unit = unit.trim();
  const currency = record['currency'];
  if (typeof currency === 'string' && currency.trim()) value.currency = currency.trim().toUpperCase();
  return { t: 'range', v: value };
}

function guidedUnknownValue(raw: unknown): FactValue | null {
  const record = objectRecord(raw);
  if (record?.['mode'] !== 'unknown') return null;
  return { t: 'string', v: "I don't know yet" };
}

function factValue(
  kind: FactKind,
  raw: unknown,
  responseFormat: GuidedQuestionResponseFormat | null,
): FactValue {
  if (kind === 'dob') return { t: 'date', v: stringFromUnknown(raw) };
  const unknown = guidedUnknownValue(raw);
  if (unknown) return unknown;
  if (responseFormat === 'range') {
    const range = rangeValue(raw);
    if (range) return range;
  }
  if (kind === 'income_annual' || kind === 'spending_monthly' || responseFormat === 'money') {
    const money = moneyValue(raw);
    if (money) return money;
    const range = rangeValue(raw);
    if (range) return range;
  }
  if (responseFormat === 'range') {
    return { t: 'string', v: stringFromUnknown(raw) };
  }
  return { t: 'string', v: stringFromUnknown(raw) };
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

function markSubmissionNeedsFollowup(
  submission: RoutedIntakeSubmission,
  intake: IntakeRecord,
  message: string,
  kind: IntakeFlag['kind'] = 'routing_failed',
): void {
  const item = currentChecklistItem(intake, submission.itemId);
  const store = useIntakeStore.getState();
  store.updateItem(submission.intakeId, {
    ...item,
    state: 'needs_followup',
  });
  store.addFlag(submission.intakeId, {
    id: `submission:${submission.submissionId}:${kind}`,
    kind,
    itemId: submission.itemId,
    submissionId: submission.submissionId,
    message,
    at: submission.submittedAt,
  });
}

function failNeedsFollowup(
  submission: RoutedIntakeSubmission,
  intake: IntakeRecord,
  message: string,
  kind: IntakeFlag['kind'] = 'routing_failed',
): never {
  markSubmissionNeedsFollowup(submission, intake, message, kind);
  throw new Error(message);
}

function contractItemOrFail(
  submission: RoutedIntakeSubmission,
  intake: IntakeRecord,
): RequestItem {
  if (submission.intakeId !== intake.intakeId) {
    return failNeedsFollowup(submission, intake, 'This submission belongs to a different request.', 'integrity_mismatch');
  }
  if (!intake.requestItems) {
    return failNeedsFollowup(
      submission,
      intake,
      'This device needs setup to receive shared intake responses.',
      'shared_intake_setup_required',
    );
  }
  const item = intake.requestItems.find((candidate) => candidate.item_id === submission.itemId);
  if (!item) return failNeedsFollowup(submission, intake, 'This submission does not match a request item.', 'integrity_mismatch');
  return item;
}

function rejectConflictingBodyMetadata(
  body: Record<string, unknown>, item: RequestItem, kind: FactKind | null,
  submission: RoutedIntakeSubmission, intake: IntakeRecord,
): void {
  if (
    (hasOwn(body, 'fact_kind') && body['fact_kind'] !== kind) ||
    (hasOwn(body, 'subject') && body['subject'] !== item.subject) ||
    (hasOwn(body, 'response_format') && body['response_format'] !== responseFormatForItem(item))
  ) {
    failNeedsFollowup(submission, intake, 'This answer conflicts with the request it was sent for.', 'integrity_mismatch');
  }
}

function submissionAnswer(
  body: Record<string, unknown>,
): { ok: true; raw: unknown } | { ok: false } {
  if (hasOwn(body, 'value')) return { ok: true, raw: body['value'] };
  if (hasOwn(body, 'answer')) return { ok: true, raw: body['answer'] };
  return { ok: false };
}

async function routeJsonSubmission(
  submission: RoutedIntakeSubmission,
  options: RouteIntakeSubmissionOptions,
): Promise<IntakeRouteResult> {
  const body = objectRecord(decodeJsonSubmission(submission));
  const item = contractItemOrFail(submission, options.intake);
  if (item.t !== 'typed_field' && item.t !== 'guided_question') {
    failNeedsFollowup(submission, options.intake, 'This request item does not accept a JSON answer.', 'integrity_mismatch');
  }
  if (!body) {
    failNeedsFollowup(
      submission,
      options.intake,
      'This client answer could not be filed safely.',
    );
  }
  const answer = submissionAnswer(body);
  if (!answer.ok) {
    failNeedsFollowup(
      submission,
      options.intake,
      'This client answer could not be filed safely.',
    );
  }
  const kind = factKindForPhoneItem(item);
  if (!kind) {
    failNeedsFollowup(
      submission,
      options.intake,
      'This client answer could not be filed safely.',
    );
  }
  rejectConflictingBodyMetadata(body, item, kind, submission, options.intake);
  const subject = item.subject;
  const fact = await (options.upsertFact ?? intakeFactUpsert)({
    matter_id: options.intake.matterId,
    subject,
    kind,
    value: factValue(kind, answer.raw, responseFormatForItem(item)),
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
  const contractItem = contractItemOrFail(submission, options.intake);
  if (contractItem.t !== 'doc_upload') {
    failNeedsFollowup(submission, options.intake, 'This request item does not accept a file.', 'integrity_mismatch');
  }
  if (submission.manifest.content_type === 'application/json') {
    failNeedsFollowup(submission, options.intake, 'A file request received a JSON answer.', 'integrity_mismatch');
  }
  if (contractItem.accepted_mime_types?.length && !contractItem.accepted_mime_types.includes(submission.manifest.content_type)) {
    failNeedsFollowup(submission, options.intake, 'This file type is not allowed for the request item.', 'integrity_mismatch');
  }
  if (submission.manifest.file_names.length > (contractItem.max_files ?? 1)) {
    failNeedsFollowup(
      submission,
      options.intake,
      'This client file package contains multiple files and could not be filed safely.',
    );
  }
  const bytes = concatBytes(submission.plaintextBytes);
  if (contractItem.max_bytes !== undefined && bytes.byteLength > contractItem.max_bytes) {
    failNeedsFollowup(submission, options.intake, 'This file is larger than the request allows.', 'integrity_mismatch');
  }
  if (!options.workspaceService) {
    throw new Error('A workspace must be open before intake documents can be filed.');
  }
  if (!options.intake.requestSlug) {
    failNeedsFollowup(submission, options.intake, 'This request is missing its safe local folder.', 'integrity_mismatch');
  }
  const item = currentChecklistItem(options.intake, submission.itemId);
  const fileName = submission.manifest.file_names[0] ?? `${item.label}.bin`;
  const filePath = await (options.fileDocument ?? fileIntakeDocument)({
    workspaceService: options.workspaceService,
    matterFolderPath: options.matterFolderPath,
    requestSlug: options.intake.requestSlug,
    fileName,
    bytes,
    documentExtraction: {
      matterId: options.intake.matterId,
      requestId: options.intake.intakeId,
      intakeId: options.intake.intakeId,
      itemId: contractItem.item_id,
      subject: contractItem.subject,
      mimeType: submission.manifest.content_type,
    },
  });
  return { filePath };
}

async function routePdfFillSubmission(
  submission: RoutedIntakeSubmission,
  options: RouteIntakeSubmissionOptions,
): Promise<IntakeRouteResult> {
  const contractItem = contractItemOrFail(submission, options.intake);
  if (contractItem.t !== 'pdf_fill') {
    failNeedsFollowup(submission, options.intake, 'This request item does not accept a completed form.', 'integrity_mismatch');
  }
  if (options.intake.kind !== 'standing') {
    failNeedsFollowup(
      submission,
      options.intake,
      'A completed form can only be filed for a standing request.',
      'integrity_mismatch',
    );
  }
  if (submission.manifest.content_type === 'application/json') {
    failNeedsFollowup(submission, options.intake, 'A completed form request received a JSON answer.', 'integrity_mismatch');
  }
  if (submission.manifest.content_type !== 'application/pdf') {
    failNeedsFollowup(submission, options.intake, 'A completed form must be returned as a PDF.', 'integrity_mismatch');
  }
  if (submission.manifest.file_names.length !== 1) {
    failNeedsFollowup(submission, options.intake, 'A completed form must contain exactly one file.', 'integrity_mismatch');
  }
  const receipt = pdfCompletionReceiptFromManifest(submission.manifest);
  if (!receipt) {
    failNeedsFollowup(submission, options.intake, 'This completed form is missing its sealed receipt.', 'integrity_mismatch');
  }
  const bytes = concatBytes(submission.plaintextBytes);
  try {
    const descriptor = await loadPdfTemplateDescriptor(submission.intakeId, submission.itemId);
    await verifyPdfFillReceipt({ completedBytes: bytes, receipt, descriptor, expectedItemId: submission.itemId });
    if (!options.workspaceService) {
      throw new Error('A workspace must be open before completed forms can be filed.');
    }
    if (!options.intake.requestSlug) {
      throw new Error('This request is missing its safe local folder.');
    }
    const filePath = await (options.fileDocument ?? fileIntakeDocument)({
      workspaceService: options.workspaceService,
      matterFolderPath: options.matterFolderPath,
      requestSlug: options.intake.requestSlug,
      folder: 'pdf_form',
      // This is code-generated from the opaque submission id, never from the
      // template, client values, or the manifest's client-provided filename.
      fileName: `completed-form-${submission.submissionId}.pdf`,
      bytes,
    });
    return { filePath };
  } catch (error) {
    failNeedsFollowup(
      submission,
      options.intake,
      error instanceof Error ? error.message : 'This completed form could not be verified or filed safely.',
      'integrity_mismatch',
    );
  }
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
  // This is sealed client-supplied context, not advisor-side classification or
  // verification. Keep only the non-sensitive "kept despite warning" signal
  // for the Onboarding surface. Never persist document text or observed values.
  const keptWarning = submission.manifest.document_detective?.find(
    (entry) => entry.kept_anyway && entry.warning_reason !== undefined,
  );
  const receivedWarning = keptWarning === undefined
    ? {}
    : {
        keptWarnedFile: true,
        keptWarnedFileReason: keptWarning.warning_reason as Tier1WarningReason,
      };
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
    ...receivedWarning,
  });
  store.setLastClientActivity(submission.intakeId, submission.submittedAt);
}

export async function routeIntakeSubmission(
  submission: RoutedIntakeSubmission,
  options: RouteIntakeSubmissionOptions,
): Promise<IntakeRouteResult> {
  const item = contractItemOrFail(submission, options.intake);
  const result = item.t === 'typed_field' || item.t === 'guided_question'
    ? submission.manifest.content_type === 'application/json'
      ? await routeJsonSubmission(submission, options)
      : failNeedsFollowup(submission, options.intake, 'A fact request received a file.', 'integrity_mismatch')
    : item.t === 'doc_upload'
      ? submission.manifest.content_type !== 'application/json'
        ? await routeFileSubmission(submission, options)
        : failNeedsFollowup(submission, options.intake, 'A file request received a JSON answer.', 'integrity_mismatch')
      : item.t === 'pdf_fill'
        ? await routePdfFillSubmission(submission, options)
        : failNeedsFollowup(submission, options.intake, 'This request item cannot receive submissions.', 'integrity_mismatch');
  if (!result.factId && !result.filePath) {
    failNeedsFollowup(
      submission,
      options.intake,
      'This client submission could not be filed safely.',
    );
  }
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
    // A successful local filing is remembered before its relay acknowledgement.
    // If that acknowledgement was lost, this recognizes the safe redelivery,
    // acknowledges it, and lets later submissions in the page continue.
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
  if (options.relayClient instanceof IntakeRelayClient) {
    const firm = useFirmStore.getState();
    if (firm.seatToken && firm.accessToken) {
      try {
        const { deviceId } = await getOrCreateDeviceKeypair();
        await discoverGrantedIntakes({
          relay: options.relayClient,
          deviceId,
          firmClient: new FirmApiClient(firm.tokenSource()),
          seatToken: firm.seatToken,
        });
      } catch (error) {
        console.warn('[useIntakeInboxSync] Intake grant discovery failed:', error);
      }
    }
  }
  const activeIntakes = Object.values(useIntakeStore.getState().intakesById)
    .filter((intake) => intake.status === 'active');
  for (const intake of activeIntakes) {
    try {
      // Team devices first install their own E2EE-wrapped private key. The
      // existing IntakeSyncClient then performs the normal decrypt-and-file run.
      if (options.relayClient instanceof IntakeRelayClient) {
        const firm = useFirmStore.getState();
        if (firm.seatToken && firm.accessToken) {
          await obtainIntakeKey(
            new FirmApiClient(firm.tokenSource()),
            intake.intakeId,
            intake.matterId,
            firm.seatToken,
          );
        }
      }
      await syncOneIntake(intake, options.relayClient, options.workspaceService);
    } catch (error) {
      console.warn('[useIntakeInboxSync] Intake inbox sync failed:', error);
    }
  }
}

type GrantedIntakeRelay = Pick<IntakeRelayClient, 'listGrantedIntakes'>;

/**
 * Discover grants that arrived on a teammate device before it ever created a
 * local IntakeRecord. The seeded record contains routing metadata only; key
 * installation must succeed before it becomes eligible for mailbox sync.
 */
export async function discoverGrantedIntakes(options: {
  relay: GrantedIntakeRelay;
  deviceId: string;
  firmClient: FirmApiClient;
  seatToken: string;
  obtainKey?: typeof obtainIntakeKey;
}): Promise<void> {
  const { intakes } = await options.relay.listGrantedIntakes(options.deviceId);
  const store = useIntakeStore.getState();
  const obtainKey = options.obtainKey ?? obtainIntakeKey;
  for (const grant of intakes) {
    const linkedMatter = useMatterStore.getState().matters.find(
      (matter) => matter.firmMatterId === grant.matter_id,
    );
    const existing = store.intakesById[grant.intake_id];
    if (existing) {
      // A remote matter may have been opened since we first seeded this grant.
      if (linkedMatter && existing.matterId !== linkedMatter.id) {
        store.updateIntake(grant.intake_id, { matterId: linkedMatter.id });
      }
      continue;
    }
    const privateKey = await obtainKey(
      options.firmClient,
      grant.intake_id,
      grant.matter_id,
      options.seatToken,
    );
    if (!privateKey) continue;
    store.upsertIntake({
      intakeId: grant.intake_id,
      // Use the linked local id when available. Until then, retain only the
      // firm routing id; no client name or ciphertext metadata is persisted.
      matterId: linkedMatter?.id ?? grant.matter_id,
      clientFirstName: '',
      firmName: '',
      status: 'active',
      expiresAt: '',
      checklistVersion: 1,
      items: [],
      receivedItems: [],
      flags: [],
      knownSessionIds: [],
      knownSubmissionIds: [],
      nudges: [],
    });
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
