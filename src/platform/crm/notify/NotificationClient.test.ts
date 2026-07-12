/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-non-null-assertion -- In-memory test doubles intentionally implement async ports synchronously; assertions establish each fixture value. */
import { describe, expect, it } from 'vitest';
import { NotificationClient } from './NotificationClient';
import { ciphertextBand } from './envelopeCrypto';
import { sealRecipientKeyHint } from './keyHintCrypto';
import { generateMatterKey, importMatterKey } from '@/platform/firm/matterCrypto';
import type {
  CrmNotifyStore,
  CrmNotifyTransaction,
  NotificationDraft,
  NotificationInboxRow,
  NotificationKeyAddress,
  NotificationRelay,
  NotificationOutboxRow,
  NotifyInboxDelivery,
  NotifySendRequest,
} from './types';

const ENVELOPE_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ENVELOPE_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

class MemoryNotifyStore implements CrmNotifyStore {
  readonly outbox = new Map<string, NotificationOutboxRow>();
  readonly inbox = new Map<string, NotificationInboxRow>();
  readonly cursors = new Map<string, number>();
  failNextSentMark = false;

  private outboxKey(orgId: string, envelopeId: string): string { return `${orgId}/${envelopeId}`; }
  private inboxKey(orgId: string, envelopeId: string): string { return `${orgId}/${envelopeId}`; }
  private cursorKey(orgId: string, deviceId: string): string { return `${orgId}/${deviceId}`; }

  async transaction<T>(work: (tx: CrmNotifyTransaction) => Promise<T>): Promise<T> {
    const tx: CrmNotifyTransaction = {
      insertNotificationOutbox: async (row) => { this.outbox.set(this.outboxKey(row.orgId, row.envelopeId), { ...row }); },
      markNotificationOutboxDependencyReady: async (orgId, envelopeId) => {
        const row = this.outbox.get(this.outboxKey(orgId, envelopeId));
        if (!row) throw new Error('Missing outbox row');
        row.referencedOperationRelayAccepted = true;
      },
      markNotificationOutboxSent: async (orgId, envelopeId, sentAt) => {
        if (this.failNextSentMark) {
          this.failNextSentMark = false;
          throw new Error('simulated crash after relay acceptance');
        }
        const row = this.outbox.get(this.outboxKey(orgId, envelopeId));
        if (!row) throw new Error('Missing outbox row');
        row.sentAt = sentAt;
      },
      markNotificationOutboxDeadLetter: async (orgId, envelopeId, reason) => {
        const row = this.outbox.get(this.outboxKey(orgId, envelopeId));
        if (!row) throw new Error('Missing outbox row');
        row.deadLetterReason = reason;
      },
      incrementNotificationOutboxAttempt: async (orgId, envelopeId) => {
        const row = this.outbox.get(this.outboxKey(orgId, envelopeId));
        if (!row) throw new Error('Missing outbox row');
        row.attempts += 1;
      },
      putNotificationInbox: async (row) => {
        const key = this.inboxKey(row.orgId, row.envelopeId);
        this.inbox.set(key, { ...row });
      },
      updateNotificationInboxState: async (orgId, envelopeId, state, deadLetterReason) => {
        const row = this.inbox.get(this.inboxKey(orgId, envelopeId));
        if (!row) throw new Error('Missing inbox row');
        row.state = state;
        row.deadLetterReason = deadLetterReason;
      },
      advanceContiguousNotificationCursor: async (orgId, deviceId) => {
        const key = this.cursorKey(orgId, deviceId);
        let cursor = this.cursors.get(key) ?? 0;
        while (Array.from(this.inbox.values()).some((row) => row.orgId === orgId && row.seq === cursor + 1)) cursor += 1;
        this.cursors.set(key, cursor);
        return cursor;
      },
    };
    return work(tx);
  }

  async listPendingNotificationOutbox(orgId: string, nowMs: number): Promise<NotificationOutboxRow[]> {
    return Array.from(this.outbox.values()).filter((row) => (
      row.orgId === orgId && row.sentAt === null && row.deadLetterReason === null && row.dispatchAfterMs <= nowMs
    ));
  }

  async listWaitingReferencedState(orgId: string, operationId: string): Promise<NotificationInboxRow[]> {
    return Array.from(this.inbox.values()).filter((row) => (
      row.orgId === orgId
      && row.state === 'waiting_for_referenced_state'
      && row.payload?.pointer.operationId === operationId
    ));
  }

  async listExpiredInformationalWaitingAccess(orgId: string, nowMs: number): Promise<NotificationInboxRow[]> {
    return Array.from(this.inbox.values()).filter((row) => (
      row.orgId === orgId
      && row.state === 'waiting_for_access'
      && row.expiresAt !== null
      && Date.parse(row.expiresAt) <= nowMs
    ));
  }
}

class MockRelay implements NotificationRelay {
  readonly sends: NotifySendRequest[] = [];
  readonly acks: Array<{ orgId: string; deviceId: string; upToCursor: number }> = [];
  async send(request: NotifySendRequest): Promise<void> { this.sends.push(request); }
  async ack(input: { orgId: string; deviceId: string; upToCursor: number }): Promise<void> { this.acks.push(input); }
}

const fixedNow = 1_700_000_000_000;

async function fixture(): Promise<{
  store: MemoryNotifyStore;
  relay: MockRelay;
  client: NotificationClient;
  address: NotificationKeyAddress;
  draft: (overrides?: Partial<NotificationDraft>) => NotificationDraft;
  applied: Set<string>;
}> {
  const key = await importMatterKey(await generateMatterKey());
  const address: NotificationKeyAddress = {
    scope: 'firm_home', firmHomeMatterId: 'firm_home', keyEpoch: 3, key, keyHint: 'recipient-only-hint',
  };
  const store = new MemoryNotifyStore();
  const relay = new MockRelay();
  const applied = new Set<string>();
  const client = new NotificationClient({
    store,
    relay,
    deviceId: 'device-a',
    keys: { resolve: async (orgId, hint) => orgId === 'org-a' && hint === address.keyHint ? address : null },
    referencedState: { hasDurablyApplied: async (operationId) => applied.has(operationId) },
    now: () => fixedNow,
  });
  return {
    store, relay, client, address, applied,
    draft: (overrides = {}) => ({
      orgId: 'org-a', recipientUserId: 'user-b', envelopeId: ENVELOPE_A,
      class: 'firm_operational', retention: 'informational', urgent: true,
      address,
      payload: {
        version: 1, type: 'workflow_due', subjectRef: 'subject-1', actorId: 'actor-a',
        displayHlc: { wallMillis: fixedNow, logicalCounter: 0, actorId: 'actor-a', operationId: 'op-1' },
        pointer: { referenceId: 'pointer-1' },
      },
      ...overrides,
    }),
  };
}

function delivery(request: NotifySendRequest, seq: number, expiresAt = new Date(fixedNow + 60_000).toISOString()): NotifyInboxDelivery {
  return {
    orgId: request.orgId, seq, envelopeId: request.envelopeId, createdAt: new Date(fixedNow).toISOString(),
    expiresAt, keyHint: request.keyHint, ciphertextB64: request.ciphertextB64,
  };
}

describe('NotificationClient', () => {
  it('encrypts a key hint to the recipient device rather than exposing its matter selection', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const hint = await sealRecipientKeyHint(
      { version: 1, scope: 'client', matterId: 'confidential-client-matter', keyEpoch: 7 },
      publicJwk,
    );
    expect(hint).not.toContain('confidential-client-matter');
    expect(atob(hint)).not.toContain('confidential-client-matter');
  });

  it('batches a non-urgent informational notice for up to 30 seconds', async () => {
    const { client, store, relay, draft } = await fixture();
    await client.queue(draft({ urgent: false }));
    expect(store.outbox.get(`org-a/${ENVELOPE_A}`)!.dispatchAfterMs).toBe(fixedNow + 30_000);
    await client.flush('org-a', 'scope');
    expect(relay.sends).toHaveLength(0);
  });

  it('replays the same idempotent envelope after a crash window and keeps ciphertext padded', async () => {
    const { client, store, relay, draft } = await fixture();
    await client.queue(draft());
    const row = store.outbox.get(`org-a/${ENVELOPE_A}`);
    expect(row).toBeDefined();
    expect(ciphertextBand(row!.ciphertextB64)).toBe(1024);
    store.failNextSentMark = true;

    await client.flush('org-a', 'transient-scope');
    await client.flush('org-a', 'transient-scope');

    expect(relay.sends).toHaveLength(2);
    expect(relay.sends.map((send) => send.idempotencyKey)).toEqual([`org-a:${ENVELOPE_A}`, `org-a:${ENVELOPE_A}`]);
    expect(relay.sends[0]!.ciphertextB64).toBe(relay.sends[1]!.ciphertextB64);
    expect(relay.sends[0]!.keyHint).toBe('recipient-only-hint');
    expect(relay.sends[0]).not.toHaveProperty('referencedOperationId');
    expect(store.outbox.get(`org-a/${ENVELOPE_A}`)!.sentAt).not.toBeNull();
  });

  it('holds an envelope until its referenced operation is relay-durable and received state exists', async () => {
    const { client, store, relay, draft, applied } = await fixture();
    const event = draft({ payload: {
      version: 1, type: 'task_assigned', subjectRef: 'task-ref', actorId: 'actor-a',
      displayHlc: { wallMillis: fixedNow, logicalCounter: 0, actorId: 'actor-a', operationId: 'op-44' },
      pointer: { referenceId: 'task-ref', operationId: 'op-44' },
    } });
    await client.queue(event);
    await client.flush('org-a', 'scope');
    expect(relay.sends).toHaveLength(0);

    await client.markReferencedOperationRelayAccepted('org-a', event.envelopeId);
    await client.flush('org-a', 'scope');
    expect(relay.sends).toHaveLength(1);

    await client.receive('org-a', 'user-b', [delivery(relay.sends[0]!, 1)]);
    expect(store.inbox.get(`org-a/${ENVELOPE_A}`)!.state).toBe('waiting_for_referenced_state');
    applied.add('op-44');
    await client.markReferencedStateApplied('org-a', 'op-44');
    expect(store.inbox.get(`org-a/${ENVELOPE_A}`)!.state).toBe('display_ready');
  });

  it('acks only the highest contiguous durable cursor', async () => {
    const { client, relay, draft } = await fixture();
    await client.queue(draft());
    await client.flush('org-a', 'scope');
    const first = relay.sends[0]!;
    const second = { ...first, envelopeId: ENVELOPE_B, idempotencyKey: `org-a:${ENVELOPE_B}` };

    await client.receive('org-a', 'user-b', [delivery(second, 2)]);
    expect(relay.acks).toHaveLength(0);
    await client.receive('org-a', 'user-b', [delivery(first, 1)]);
    expect(relay.acks.at(-1)).toEqual({ orgId: 'org-a', deviceId: 'device-a', upToCursor: 2 });
  });

  it('dead-letters expired informational envelopes but retains approval envelopes for access retry', async () => {
    const { client, store, relay, draft } = await fixture();
    await client.queue(draft());
    await client.flush('org-a', 'scope');
    const info = { ...delivery(relay.sends[0]!, 1, new Date(fixedNow - 1).toISOString()), keyHint: 'missing-key' };
    const approval = { ...info, seq: 2, envelopeId: ENVELOPE_B, expiresAt: null };
    await client.receive('org-a', 'user-b', [info, approval]);

    expect(store.inbox.get(`org-a/${ENVELOPE_A}`)!.state).toBe('dead_letter');
    expect(store.inbox.get(`org-a/${ENVELOPE_A}`)!.deadLetterReason).toBe('key_hint_unavailable');
    expect(store.inbox.get(`org-a/${ENVELOPE_B}`)!.state).toBe('waiting_for_access');
    expect(store.inbox.get(`org-a/${ENVELOPE_B}`)!.deadLetterReason).toBeNull();
  });

  it('keeps inbox rows, cursors, and acknowledgements separate by organization', async () => {
    const { client, store, relay, draft } = await fixture();
    await client.queue(draft());
    await client.flush('org-a', 'scope');
    const first = delivery(relay.sends[0]!, 1);
    await client.receive('org-a', 'user-b', [first]);
    await expect(client.receive('org-a', 'user-b', [{ ...first, orgId: 'org-b' }])).rejects.toThrow('cannot mix organizations');
    expect(store.cursors.get('org-a/device-a')).toBe(1);
    expect(store.cursors.get('org-b/device-a')).toBeUndefined();
    expect(relay.acks).toEqual([{ orgId: 'org-a', deviceId: 'device-a', upToCursor: 1 }]);
  });
});
