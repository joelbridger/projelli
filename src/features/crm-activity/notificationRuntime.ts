import { NotificationClient } from '@/platform/crm/notify/NotificationClient';
import { createNotificationEnvelopeId, type CrmNotifyStore, type CrmNotifyTransaction, type NotificationInboxRow, type NotificationKeyAddress, type NotificationOutboxRow } from '@/platform/crm/notify/types';
import { openRecipientKeyHint, sealRecipientKeyHint } from '@/platform/crm/notify/keyHintCrypto';
import { importMatterKey } from '@/platform/firm/matterCrypto';
import { getMatterKey } from '@/platform/firm/matterKeyService';
import { getOrCreateDeviceKeypair } from '@/platform/firm/deviceKeys';
import { useFirmStore } from '@/platform/firm/firmStore';
import { saveLiveCrmRecord, type LiveCrmRecord } from '@/platform/crm/liveRecords';
import { loadVisibleCrmRecordsForViewer } from '@/platform/crm/useLiveCrmRecords';

type StoredOutbox = LiveCrmRecord & { row: NotificationOutboxRow };
type StoredInbox = LiveCrmRecord & { row: NotificationInboxRow };

/** SQLCipher-backed through the live-record boundary. The records contain only sealed envelopes and relay metadata. */
class LiveRecordNotifyStore implements CrmNotifyStore {
  constructor(private readonly workspaceRoot: string) {}
  private async all() {
    return loadVisibleCrmRecordsForViewer(
      this.workspaceRoot,
      useFirmStore.getState().session?.userId ?? null
    );
  }
  private async outbox(orgId: string, envelopeId: string) { return (await this.all()).find((record): record is StoredOutbox => record.kind === 'crmNotifyOutbox' && record['orgId'] === orgId && record['envelopeId'] === envelopeId); }
  private async inbox(orgId: string, envelopeId: string) { return (await this.all()).find((record): record is StoredInbox => record.kind === 'crmNotifyInbox' && record['orgId'] === orgId && record['envelopeId'] === envelopeId); }
  private save(record: LiveCrmRecord) { return saveLiveCrmRecord(this.workspaceRoot, record); }
  async transaction<T>(work: (tx: CrmNotifyTransaction) => Promise<T>): Promise<T> {
    const tx: CrmNotifyTransaction = {
      insertNotificationOutbox: async (row) => { await this.save({ id: `notify-outbox:${row.orgId}:${row.envelopeId}`, kind: 'crmNotifyOutbox', matterId: 'firm_home', orgId: row.orgId, envelopeId: row.envelopeId, row }); },
      markNotificationOutboxDependencyReady: async (orgId, envelopeId) => { const record = await this.outbox(orgId, envelopeId); if (!record) throw new Error('Notification outbox row is missing.'); await this.save({ ...record, row: { ...record.row, referencedOperationRelayAccepted: true } }); },
      markNotificationOutboxSent: async (orgId, envelopeId, sentAt) => { const record = await this.outbox(orgId, envelopeId); if (!record) throw new Error('Notification outbox row is missing.'); await this.save({ ...record, row: { ...record.row, sentAt } }); },
      markNotificationOutboxDeadLetter: async (orgId, envelopeId, deadLetterReason) => { const record = await this.outbox(orgId, envelopeId); if (!record) throw new Error('Notification outbox row is missing.'); await this.save({ ...record, row: { ...record.row, deadLetterReason } }); },
      incrementNotificationOutboxAttempt: async (orgId, envelopeId) => { const record = await this.outbox(orgId, envelopeId); if (!record) throw new Error('Notification outbox row is missing.'); await this.save({ ...record, row: { ...record.row, attempts: record.row.attempts + 1 } }); },
      putNotificationInbox: async (row) => { await this.save({ id: `notify-inbox:${row.orgId}:${row.envelopeId}`, kind: 'crmNotifyInbox', matterId: 'firm_home', orgId: row.orgId, envelopeId: row.envelopeId, row }); },
      updateNotificationInboxState: async (orgId, envelopeId, state, deadLetterReason) => { const record = await this.inbox(orgId, envelopeId); if (!record) throw new Error('Notification inbox row is missing.'); await this.save({ ...record, row: { ...record.row, state, deadLetterReason } }); },
      advanceContiguousNotificationCursor: async (orgId, deviceId) => { const rows = (await this.all()).filter((record): record is StoredInbox => record.kind === 'crmNotifyInbox' && record['orgId'] === orgId).map((record) => record.row).sort((a, b) => a.seq - b.seq); let cursor = 0; while (rows.some((row) => row.seq === cursor + 1)) cursor += 1; await this.save({ id: `notify-cursor:${orgId}:${deviceId}`, kind: 'crmNotifyCursor', matterId: 'firm_home', orgId, deviceId, cursor }); return cursor; },
    };
    return work(tx);
  }
  async listPendingNotificationOutbox(orgId: string, nowMs: number) { return (await this.all()).filter((record): record is StoredOutbox => record.kind === 'crmNotifyOutbox' && record['orgId'] === orgId).map((record) => record.row).filter((row) => row.sentAt === null && row.deadLetterReason === null && row.dispatchAfterMs <= nowMs); }
  async listWaitingReferencedState(orgId: string, operationId: string) { return (await this.all()).filter((record): record is StoredInbox => record.kind === 'crmNotifyInbox' && record['orgId'] === orgId).map((record) => record.row).filter((row) => row.state === 'waiting_for_referenced_state' && row.payload?.pointer.operationId === operationId); }
  async listExpiredInformationalWaitingAccess(orgId: string, nowMs: number) { return (await this.all()).filter((record): record is StoredInbox => record.kind === 'crmNotifyInbox' && record['orgId'] === orgId).map((record) => record.row).filter((row) => row.state === 'waiting_for_access' && row.expiresAt !== null && Date.parse(row.expiresAt) <= nowMs); }
}

export async function sendFirmMention(input: { workspaceRoot: string; firmMatterId: string; recipientUserId: string; noteId: string }): Promise<boolean> {
  const firm = useFirmStore.getState();
  const orgId = firm.session?.org?.org_id;
  if (!orgId || !firm.seatToken || !firm.session?.userId) return false;
  const client = firm.client();
  const [keyB64, mine, devices, device] = await Promise.all([getMatterKey(input.firmMatterId), client.matterMine(firm.seatToken), client.fetchOrgUserDevices([input.recipientUserId]), getOrCreateDeviceKeypair()]);
  const recipient = devices.devices.find((item) => item.user_id === input.recipientUserId);
  const epoch = mine.matters.find((item) => item.matter_id === input.firmMatterId)?.key_epoch;
  if (!keyB64 || !recipient || epoch === undefined) return false;
  const address: NotificationKeyAddress = { scope: 'firm_home', firmHomeMatterId: input.firmMatterId, keyEpoch: epoch, key: await importMatterKey(keyB64), keyHint: await sealRecipientKeyHint({ version: 1, scope: 'firm_home', matterId: input.firmMatterId, keyEpoch: epoch }, recipient.pubkey_jwk) };
  const notify = new NotificationClient({ store: new LiveRecordNotifyStore(input.workspaceRoot), deviceId: device.deviceId, keys: { resolve: async (_org, hint) => { const opened = await openRecipientKeyHint(hint); if (!opened) return null; const raw = await getMatterKey(opened.matterId); return raw ? { scope: 'firm_home', firmHomeMatterId: opened.matterId, keyEpoch: opened.keyEpoch, key: await importMatterKey(raw), keyHint: hint } : null; } }, referencedState: { hasDurablyApplied: async () => true }, relay: { send: async (request) => { await client.notifySend({ ...request, transientScope: JSON.parse(request.transientScope) as { matter_id: string }, seatToken: firm.seatToken! }); }, ack: async (ack) => { await client.notifyAck(ack.orgId, ack.deviceId, ack.upToCursor, firm.seatToken!); } } });
  const envelopeId = createNotificationEnvelopeId();
  await notify.queue({ orgId, recipientUserId: input.recipientUserId, envelopeId, class: 'firm_operational', retention: 'informational', urgent: true, address, payload: { version: 1, type: 'mention', subjectRef: input.noteId, actorId: firm.session.userId, displayHlc: { wallMillis: Date.now(), logicalCounter: 0, actorId: firm.session.userId, operationId: `mention:${envelopeId}` }, pointer: { referenceId: input.noteId } } });
  await notify.flush(orgId, JSON.stringify({ matter_id: input.firmMatterId }));
  return true;
}

/** Pull the relay's source-of-truth inbox before rendering it. A live socket is only a wake-up path. */
export async function pullFirmInbox(workspaceRoot: string): Promise<boolean> {
  const firm = useFirmStore.getState();
  const orgId = firm.session?.org?.org_id;
  if (!orgId || !firm.seatToken || !firm.session?.userId) return false;
  const client = firm.client();
  const device = await getOrCreateDeviceKeypair();
  const store = new LiveRecordNotifyStore(workspaceRoot);
  const cursorRecord = (
    await loadVisibleCrmRecordsForViewer(workspaceRoot, firm.session.userId)
  ).find((record) => record.kind === 'crmNotifyCursor' && record['orgId'] === orgId && record['deviceId'] === device.deviceId);
  const since = typeof cursorRecord?.['cursor'] === 'number' ? cursorRecord['cursor'] : 0;
  const notify = new NotificationClient({ store, deviceId: device.deviceId, keys: { resolve: async (_org, hint) => { const opened = await openRecipientKeyHint(hint); if (!opened) return null; const raw = await getMatterKey(opened.matterId); return raw ? { scope: 'firm_home', firmHomeMatterId: opened.matterId, keyEpoch: opened.keyEpoch, key: await importMatterKey(raw), keyHint: hint } : null; } }, referencedState: { hasDurablyApplied: async () => true }, relay: { send: async () => undefined, ack: async (ack) => { await client.notifyAck(ack.orgId, ack.deviceId, ack.upToCursor, firm.seatToken!); } } });
  const inbox = await client.notifyInbox(orgId, since, firm.seatToken);
  if (inbox.envelopes.length) await notify.receive(orgId, firm.session.userId, inbox.envelopes.map((row) => ({ orgId, seq: row.seq, envelopeId: row.envelope_id, createdAt: row.created_at, expiresAt: row.expires_at, keyHint: row.key_hint, ciphertextB64: row.ciphertext_b64 })));
  return true;
}
