import { openEnvelope, sealEnvelope } from './envelopeCrypto';
import { isNotificationEnvelopeId } from './types';
import type {
  CrmNotifyStore,
  CrmNotifyTransaction,
  NotificationDraft,
  NotificationInboxRow,
  NotificationKeyResolver,
  NotificationRelay,
  ReferencedStateLookup,
} from './types';

const INFORMATIONAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_DELAY_MS = 30_000;

export interface NotificationClientOptions {
  store: CrmNotifyStore;
  relay: NotificationRelay;
  deviceId: string;
  /** Obtains the correct key from the recipient-only key hint. */
  keys: NotificationKeyResolver;
  referencedState: ReferencedStateLookup;
  now?: () => number;
}

/**
 * The local-only notification coordinator. Its store is SQLCipher-backed in
 * production; its interface intentionally makes inbox changes and cursor
 * movement one transaction so a crash can only cause an idempotent replay.
 */
export class NotificationClient {
  private readonly now: () => number;

  constructor(private readonly options: NotificationClientOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Use this inside B1's existing business-mutation transaction. It writes the
   * notification outbox row beside the CRM mutation, immutable operation, and
   * activity outbox row; it never opens a second transaction.
   */
  async queueInBusinessTransaction(tx: CrmNotifyTransaction, draft: NotificationDraft): Promise<void> {
    if (!isNotificationEnvelopeId(draft.envelopeId)) {
      throw new Error('Notification envelope IDs must be random 128-bit opaque lowercase hex values.');
    }
    const now = this.now();
    const ciphertextB64 = await sealEnvelope(
      draft.orgId,
      draft.recipientUserId,
      draft.class,
      draft.address,
      draft.payload,
    );
    const immediate = draft.urgent === true || draft.retention === 'approval' || isAssignment(draft.payload.type);
    await tx.insertNotificationOutbox({
      orgId: draft.orgId,
      recipientUserId: draft.recipientUserId,
      envelopeId: draft.envelopeId,
      ciphertextB64,
      keyHint: draft.address.keyHint,
      retention: draft.retention,
      expiresAt: draft.retention === 'informational'
        ? new Date(now + INFORMATIONAL_TTL_MS).toISOString()
        : null,
      dispatchAfterMs: immediate ? now : now + BATCH_DELAY_MS,
      referencedOperationRelayAccepted: draft.payload.pointer.operationId === undefined,
      idempotencyKey: `${draft.orgId}:${draft.envelopeId}`,
      attempts: 0,
      sentAt: null,
      deadLetterReason: null,
    });
  }

  /** Convenience only for non-business events; CRM mutations must use the method above. */
  async queue(draft: NotificationDraft): Promise<void> {
    await this.options.store.transaction((tx) => this.queueInBusinessTransaction(tx, draft));
  }

  /**
   * Send due, dependency-ready outbox rows. If a crash lands after the relay
   * accepts but before `sentAt` is persisted, the same scoped idempotency key
   * is deliberately replayed.
   */
  async flush(orgId: string, transientScope: string): Promise<number> {
    const rows = await this.options.store.listPendingNotificationOutbox(orgId, this.now());
    let sent = 0;
    for (const row of rows) {
      if (row.expiresAt !== null && Date.parse(row.expiresAt) <= this.now()) {
        await this.options.store.transaction((tx) => tx.markNotificationOutboxDeadLetter(
          row.orgId,
          row.envelopeId,
          'expired_before_relay_delivery',
        ));
        continue;
      }
      if (!row.referencedOperationRelayAccepted) continue; // D18: never leak linkage to relay.
      try {
        await this.options.relay.send({
          orgId: row.orgId,
          recipientUserId: row.recipientUserId,
          envelopeId: row.envelopeId,
          ciphertextB64: row.ciphertextB64,
          transientScope,
          keyHint: row.keyHint,
          idempotencyKey: row.idempotencyKey,
          retentionUntilTerminal: row.retention === 'approval',
          expiresAt: row.expiresAt,
        });
        await this.options.store.transaction((tx) => tx.markNotificationOutboxSent(
          row.orgId,
          row.envelopeId,
          new Date(this.now()).toISOString(),
        ));
        sent += 1;
      } catch {
        await this.options.store.transaction((tx) => tx.incrementNotificationOutboxAttempt(row.orgId, row.envelopeId));
      }
    }
    return sent;
  }

  /** B1 calls this after its relay operation/blob acceptance is durable (D18). */
  async markReferencedOperationRelayAccepted(orgId: string, envelopeId: string): Promise<void> {
    await this.options.store.transaction((tx) => tx.markNotificationOutboxDependencyReady(orgId, envelopeId));
  }

  /**
   * Persist inbox deliveries before acknowledging. A storage implementation
   * advances only through adjacent durable sequence numbers; a later sequence
   * can be saved now but cannot make the ack skip an earlier delivery.
   */
  async receive(orgId: string, recipientUserId: string, deliveries: readonly import('./types').NotifyInboxDelivery[]): Promise<void> {
    if (deliveries.some((delivery) => delivery.orgId !== orgId)) {
      throw new Error('A notification inbox batch cannot mix organizations.');
    }
    let ackThrough: number | null = null;
    for (const delivery of deliveries) {
      const row = await this.toInboxRow(recipientUserId, delivery);
      const cursor = await this.options.store.transaction(async (tx) => {
        await tx.putNotificationInbox(row);
        return tx.advanceContiguousNotificationCursor(orgId, this.options.deviceId);
      });
      ackThrough = ackThrough === null ? cursor : Math.max(ackThrough, cursor);
    }
    if (ackThrough !== null && ackThrough > 0) {
      await this.options.relay.ack({ orgId, deviceId: this.options.deviceId, upToCursor: ackThrough });
    }
  }

  /** Turn D18 waiting entries display-ready after the referenced operation lands locally. */
  async markReferencedStateApplied(orgId: string, operationId: string): Promise<void> {
    const waiting = await this.options.store.listWaitingReferencedState(orgId, operationId);
    if (waiting.length === 0) return;
    await this.options.store.transaction(async (tx) => {
      for (const row of waiting) {
        await tx.updateNotificationInboxState(orgId, row.envelopeId, 'display_ready', null);
      }
    });
  }

  /** Scheduled locally: informational items never wait forever for an unavailable key. */
  async expireUndecryptableInformational(orgId: string): Promise<void> {
    const expired = await this.options.store.listExpiredInformationalWaitingAccess(orgId, this.now());
    if (expired.length === 0) return;
    await this.options.store.transaction(async (tx) => {
      for (const row of expired) {
        await tx.updateNotificationInboxState(orgId, row.envelopeId, 'dead_letter', 'access_unavailable_at_ttl');
      }
    });
  }

  private async toInboxRow(
    recipientUserId: string,
    delivery: import('./types').NotifyInboxDelivery,
  ): Promise<NotificationInboxRow> {
    const retention = delivery.expiresAt === null ? 'approval' : 'informational';
    let address = await this.options.keys.resolve(delivery.orgId, delivery.keyHint);
    let opened = address === null
      ? null
      : await openEnvelope(delivery.orgId, recipientUserId, address, delivery.ciphertextB64);
    if ((address === null || !opened?.ok) && this.options.keys.refreshAccess) {
      address = await this.options.keys.refreshAccess(delivery.orgId, delivery.keyHint);
      opened = address === null
        ? null
        : await openEnvelope(delivery.orgId, recipientUserId, address, delivery.ciphertextB64);
    }
    if (!opened?.ok) return this.unavailableRow(delivery, retention, opened?.reason ?? 'key_hint_unavailable');

    const payload = opened.payload;
    const operationId = payload.pointer.operationId;
    const hasState = operationId === undefined || await this.options.referencedState.hasDurablyApplied(operationId);
    return {
      ...delivery,
      state: hasState ? 'display_ready' : 'waiting_for_referenced_state',
      payload,
      deadLetterReason: null,
    };
  }

  private unavailableRow(
    delivery: import('./types').NotifyInboxDelivery,
    retention: 'informational' | 'approval',
    reason: string,
  ): NotificationInboxRow {
    const expired = delivery.expiresAt !== null && Date.parse(delivery.expiresAt) <= this.now();
    return {
      ...delivery,
      state: retention === 'informational' && expired ? 'dead_letter' : 'waiting_for_access',
      payload: null,
      deadLetterReason: retention === 'informational' && expired ? reason : null,
    };
  }
}

function isAssignment(type: string): boolean {
  return type === 'task_assigned' || type === 'task_reassigned';
}
