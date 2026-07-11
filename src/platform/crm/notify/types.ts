/**
 * Contracts for the client-side sealed notification path.
 *
 * The relay only receives `NotifySendRequest`: recipient routing metadata,
 * opaque key hint, opaque envelope id, and ciphertext.  It never receives the
 * decrypted payload, its type, the operation it points at, or the sender.
 */

import type { HlcStamp } from '@/platform/crm/types';
export type { HlcStamp } from '@/platform/crm/types';

export type NotificationClass = 'firm_operational' | 'client_confidential';
export type NotificationRetention = 'informational' | 'approval';
export type NotificationInboxState =
  | 'display_ready'
  | 'waiting_for_referenced_state'
  | 'waiting_for_access'
  | 'dead_letter';

/** A pointer only; text, client details, and other content do not belong here. */
export interface NotificationPointer {
  referenceId: string;
  /** D18 dependency. This stays inside the encrypted envelope. */
  operationId?: string;
}

/** This is encrypted as a whole before it leaves the sender's device. */
export interface SealedEnvelopePayload {
  version: 1;
  type: string;
  subjectRef: string;
  displayHlc: HlcStamp;
  actorId: string;
  pointer: NotificationPointer;
}

/**
 * The selected content key must match the class. `keyHint` is separately
 * encrypted for the recipient by the caller and stays opaque to this module.
 */
export type NotificationKeyAddress =
  | {
      scope: 'firm_home';
      firmHomeMatterId: string;
      keyEpoch: number;
      key: CryptoKey;
      keyHint: string;
    }
  | {
      scope: 'client';
      matterId: string;
      keyEpoch: number;
      key: CryptoKey;
      keyHint: string;
    };

export interface NotificationDraft {
  orgId: string;
  recipientUserId: string;
  envelopeId: string;
  class: NotificationClass;
  retention: NotificationRetention;
  /** Assignments and approvals are immediate; ordinary notices may batch. */
  urgent?: boolean;
  payload: SealedEnvelopePayload;
  address: NotificationKeyAddress;
}

/** A fixed-format, random 128-bit opaque id. It has no business meaning. */
export function createNotificationEnvelopeId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isNotificationEnvelopeId(value: string): boolean {
  return /^[a-f0-9]{32}$/.test(value);
}

export interface NotificationOutboxRow {
  orgId: string;
  recipientUserId: string;
  envelopeId: string;
  ciphertextB64: string;
  keyHint: string;
  retention: NotificationRetention;
  /** Null for approval class; informational notices expire after seven days. */
  expiresAt: string | null;
  /** Non-urgent notices wait no longer than 30 seconds before dispatch. */
  dispatchAfterMs: number;
  /** D18: true only after the referenced immutable operation is relay-durable. */
  referencedOperationRelayAccepted: boolean;
  idempotencyKey: string;
  attempts: number;
  sentAt: string | null;
  deadLetterReason: string | null;
}

export interface NotifyInboxDelivery {
  orgId: string;
  seq: number;
  envelopeId: string;
  createdAt: string;
  expiresAt: string | null;
  keyHint: string;
  ciphertextB64: string;
}

export interface NotificationInboxRow extends NotifyInboxDelivery {
  state: NotificationInboxState;
  payload: SealedEnvelopePayload | null;
  deadLetterReason: string | null;
}

export interface NotifySendRequest {
  orgId: string;
  recipientUserId: string;
  envelopeId: string;
  ciphertextB64: string;
  /** Transient authorization only; it must never be persisted in this client store. */
  transientScope: string;
  keyHint: string;
  idempotencyKey: string;
  retentionUntilTerminal: boolean;
  expiresAt: string | null;
}

export interface NotificationRelay {
  send(request: NotifySendRequest): Promise<void>;
  ack(input: { orgId: string; deviceId: string; upToCursor: number }): Promise<void>;
}

/**
 * This is the narrow SQLCipher transaction surface required by this lane.
 * Implementations make every call inside one real database
 * transaction. In particular, business mutation + immutable operation +
 * activity outbox + notification outbox share a transaction.
 */
export interface CrmNotifyTransaction {
  insertNotificationOutbox(row: NotificationOutboxRow): Promise<void>;
  /** Called only after the referenced immutable operation/blob is relay-durable. */
  markNotificationOutboxDependencyReady(orgId: string, envelopeId: string): Promise<void>;
  markNotificationOutboxSent(orgId: string, envelopeId: string, sentAt: string): Promise<void>;
  markNotificationOutboxDeadLetter(orgId: string, envelopeId: string, reason: string): Promise<void>;
  incrementNotificationOutboxAttempt(orgId: string, envelopeId: string): Promise<void>;
  putNotificationInbox(row: NotificationInboxRow): Promise<void>;
  updateNotificationInboxState(
    orgId: string,
    envelopeId: string,
    state: NotificationInboxState,
    deadLetterReason: string | null,
  ): Promise<void>;
  /** Returns the new highest contiguous cursor for this organization/device. */
  advanceContiguousNotificationCursor(orgId: string, deviceId: string): Promise<number>;
}

export interface CrmNotifyStore {
  transaction<T>(work: (tx: CrmNotifyTransaction) => Promise<T>): Promise<T>;
  listPendingNotificationOutbox(orgId: string, nowMs: number): Promise<NotificationOutboxRow[]>;
  listWaitingReferencedState(orgId: string, operationId: string): Promise<NotificationInboxRow[]>;
  listExpiredInformationalWaitingAccess(orgId: string, nowMs: number): Promise<NotificationInboxRow[]>;
}

/** Resolves the recipient-only encrypted key hint without exposing it to the relay. */
export interface NotificationKeyResolver {
  resolve(orgId: string, keyHint: string): Promise<NotificationKeyAddress | null>;
  /** One current-grant/key refresh before an informational item becomes dead-lettered. */
  refreshAccess?(orgId: string, keyHint: string): Promise<NotificationKeyAddress | null>;
}

export interface ReferencedStateLookup {
  hasDurablyApplied(operationId: string): Promise<boolean>;
}
