import { describe, expect, it } from 'vitest';
import { importMatterKey, generateMatterKey } from '@/platform/firm/matterCrypto';
import { NotificationClient } from '@/platform/crm/notify/NotificationClient';
import type { CrmNotifyStore, CrmNotifyTransaction, NotificationDraft, NotificationInboxRow, NotificationKeyAddress, NotificationOutboxRow, NotificationRelay, NotifyInboxDelivery, NotifySendRequest } from '@/platform/crm/notify/types';

const NOW = 1_700_000_000_000;
const ENVELOPE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

class Store implements CrmNotifyStore {
  outbox = new Map<string, NotificationOutboxRow>();
  inbox = new Map<string, NotificationInboxRow>();
  async transaction<T>(work: (tx: CrmNotifyTransaction) => Promise<T>): Promise<T> {
    const tx: CrmNotifyTransaction = {
      insertNotificationOutbox: async (row) => { this.outbox.set(row.envelopeId, { ...row }); },
      markNotificationOutboxDependencyReady: async (_org, id) => { this.outbox.get(id)!.referencedOperationRelayAccepted = true; },
      markNotificationOutboxSent: async (_org, id, at) => { this.outbox.get(id)!.sentAt = at; },
      markNotificationOutboxDeadLetter: async (_org, id, reason) => { this.outbox.get(id)!.deadLetterReason = reason; },
      incrementNotificationOutboxAttempt: async (_org, id) => { this.outbox.get(id)!.attempts += 1; },
      putNotificationInbox: async (row) => { this.inbox.set(row.envelopeId, { ...row }); },
      updateNotificationInboxState: async (_org, id, state, reason) => { const row = this.inbox.get(id)!; row.state = state; row.deadLetterReason = reason; },
      advanceContiguousNotificationCursor: async () => 1,
    };
    return work(tx);
  }
  async listPendingNotificationOutbox(orgId: string, now: number): Promise<NotificationOutboxRow[]> {
    return [...this.outbox.values()].filter((row) => row.orgId === orgId && row.sentAt === null && row.deadLetterReason === null && row.dispatchAfterMs <= now);
  }
  async listWaitingReferencedState(orgId: string, operationId: string): Promise<NotificationInboxRow[]> {
    return [...this.inbox.values()].filter((row) => row.orgId === orgId && row.state === 'waiting_for_referenced_state' && row.payload?.pointer.operationId === operationId);
  }
  async listExpiredInformationalWaitingAccess(): Promise<NotificationInboxRow[]> { return []; }
}

class Relay implements NotificationRelay {
  sends: NotifySendRequest[] = [];
  async send(request: NotifySendRequest): Promise<void> { this.sends.push(request); }
  async ack(): Promise<void> {}
}

async function fixture(): Promise<{ client: NotificationClient; store: Store; relay: Relay; address: NotificationKeyAddress; draft: (overrides?: Partial<NotificationDraft>) => NotificationDraft }> {
  const address: NotificationKeyAddress = { scope: 'firm_home', firmHomeMatterId: 'firm_home', keyEpoch: 1, key: await importMatterKey(await generateMatterKey()), keyHint: 'hint' };
  const store = new Store();
  const relay = new Relay();
  const client = new NotificationClient({
    store, relay, deviceId: 'device-1', now: () => NOW,
    keys: { resolve: async () => address }, referencedState: { hasDurablyApplied: async () => false },
  });
  return {
    client, store, relay, address,
    draft: (overrides = {}) => ({
      orgId: 'org-1', recipientUserId: 'user-1', envelopeId: ENVELOPE, class: 'firm_operational', retention: 'informational', urgent: true, address,
      payload: { version: 1, type: 'workflow_due', subjectRef: 'opaque-subject', actorId: 'actor-1', displayHlc: { wallMillis: NOW, logicalCounter: 0, actorId: 'actor-1', operationId: 'op-1' }, pointer: { referenceId: 'opaque-pointer' } },
      ...overrides,
    }),
  };
}

describe('Sealed notification envelope delivery', () => {
  it('keeps envelope class retention in encrypted client rows: informational expires after seven days, approval does not', async () => {
    const { client, store, draft } = await fixture();
    await client.queue(draft());
    const info = store.outbox.get(ENVELOPE)!;
    expect(info.expiresAt).toBe(new Date(NOW + 7 * 24 * 60 * 60 * 1000).toISOString());
    expect(info.ciphertextB64).not.toContain('opaque-subject');
    const approvalId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    await client.queue(draft({ envelopeId: approvalId, retention: 'approval' }));
    expect(store.outbox.get(approvalId)).toMatchObject({ expiresAt: null, dispatchAfterMs: NOW });
  });

  it('D18 holds a dependent envelope until its immutable operation is relay-durable', async () => {
    const { client, store, relay, draft } = await fixture();
    const dependent = draft({ payload: { version: 1, type: 'task_assigned', subjectRef: 'task', actorId: 'actor-1', displayHlc: { wallMillis: NOW, logicalCounter: 0, actorId: 'actor-1', operationId: 'op-9' }, pointer: { referenceId: 'task', operationId: 'op-9' } } });
    await client.queue(dependent);
    await client.flush('org-1', 'scope');
    expect(relay.sends).toHaveLength(0);
    expect(store.outbox.get(ENVELOPE)!.referencedOperationRelayAccepted).toBe(false);
    await client.markReferencedOperationRelayAccepted('org-1', ENVELOPE);
    await client.flush('org-1', 'scope');
    expect(relay.sends).toHaveLength(1);
    expect(relay.sends[0]).not.toHaveProperty('operationId');
  });

  it('holds an early received envelope until its referenced state is durable locally', async () => {
    const { client, store, relay, draft } = await fixture();
    const dependent = draft({ payload: { version: 1, type: 'task_assigned', subjectRef: 'task', actorId: 'actor-1', displayHlc: { wallMillis: NOW, logicalCounter: 0, actorId: 'actor-1', operationId: 'op-9' }, pointer: { referenceId: 'task', operationId: 'op-9' } } });
    await client.queue(dependent);
    await client.markReferencedOperationRelayAccepted('org-1', ENVELOPE);
    await client.flush('org-1', 'scope');
    const sent = relay.sends[0]!;
    const delivery: NotifyInboxDelivery = { orgId: 'org-1', seq: 1, envelopeId: ENVELOPE, createdAt: new Date(NOW).toISOString(), expiresAt: sent.expiresAt, keyHint: sent.keyHint, ciphertextB64: sent.ciphertextB64 };
    await client.receive('org-1', 'user-1', [delivery]);
    expect(store.inbox.get(ENVELOPE)!.state).toBe('waiting_for_referenced_state');
    await client.markReferencedStateApplied('org-1', 'op-9');
    expect(store.inbox.get(ENVELOPE)!.state).toBe('display_ready');
  });

  // EXAM-BLOCKED: the merged client port cannot model relay eligibility, active devices, terminal approval retention, or wall/key rotation.
  it.skip('enforces relay-side delivery and wall rules across offline devices');
});
