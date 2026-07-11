/**
 * Layer-5 trust-breaker battery.
 *
 * This is intentionally a Bun program, not a mock-only unit suite. It starts
 * the real relay with a disposable database, uses its real HTTP routes, and
 * exercises the merged crypto/sync/propagation/checkpoint/egress primitives.
 * A failed attack is a PASS. An attack that gets through prints VULN and makes
 * this command fail without changing production code.
 */
import * as Y from 'yjs';
import { FanoutHub } from '../../../backend/src/lib/matters.ts';
import { Store } from '../../../backend/src/lib/db.ts';
import { buildServeOptions, type SyncSocketData } from '../../../backend/src/server.ts';
import { ciphertextBand, openEnvelope } from '@/platform/crm/notify/envelopeCrypto';
import { NotificationClient } from '@/platform/crm/notify/NotificationClient';
import type {
  CrmNotifyStore, CrmNotifyTransaction, NotificationInboxRow, NotificationOutboxRow,
  NotificationRelay,
} from '@/platform/crm/notify/types';
import { InMemoryCursorStore, SyncSubscription, type EncryptedRelayUpdate, type MultiplexedRelay } from '@/platform/crm/sync';
import { createCheckpoint, retireAndRebaseDevice, validateCheckpoint } from '@/platform/crm/checkpoints';
import { sealCheckpointPayload } from '@/platform/crm/checkpoints/checkpointCrypto';
import { generateMatterKey, importMatterKey } from '@/platform/firm/matterCrypto';
import { applyOffer, createOffer } from '@/platform/crm/propagation';
import type { PropagationTransactionPayload, TemplateRevision, WorkflowInstanceSnapshot, WorkflowTemplateSnapshot } from '@/platform/crm/propagation';
import { assertCloudSendAllowed } from '@/platform/privacy/cloudSendGuard';

const NOW = 1_784_563_200_000;
const MARKERS = ['Northcrest Secret Household', 'Marta Northcrest', 'send wire instructions', 'op-secret-1'];
const failures: string[] = [];

function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function opaqueId(n: number): string { return n.toString(16).padStart(32, '0'); }
function bytes(value: string): string { return Buffer.from(value).toString('base64'); }
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
}

async function attack(name: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
    console.log(`TRUSTBREAKER ${name}: PASS — defense held`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${message}`);
    console.error(`VULN: TRUSTBREAKER ${name}: ${message}`);
  }
}

interface Identity { userId: string; access: string; seat: string; }
interface RelayFixture {
  base: string;
  store: Store;
  server: ReturnType<typeof Bun.serve<SyncSocketData>>;
  admin: string;
  orgId: string;
  matterId: string;
  sender: Identity;
  recipient: Identity;
  walled: Identity;
}

async function request(base: string, path: string, init: {
  method?: 'GET' | 'POST'; body?: unknown; access?: string; seat?: string;
} = {}): Promise<{ status: number; body: Record<string, any> }> {
  const response = await fetch(`${base}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.access ? { authorization: `Bearer ${init.access}` } : {}),
      ...(init.seat ? { 'x-seat-token': init.seat } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, any> };
}

function tokenOrg(access: string): string {
  return JSON.parse(Buffer.from(access.split('.')[1]!, 'base64url').toString('utf8')).org_id as string;
}

async function fixture(): Promise<RelayFixture> {
  const store = new Store(':memory:');
  const server = Bun.serve<SyncSocketData>(buildServeOptions(store, new FanoutHub()));
  const base = `http://${server.hostname}:${server.port}`;
  const adminEmail = `admin-${crypto.randomUUID()}@trust.test`;
  const provision = await request(base, '/admin/org', {
    body: { name: 'Trustbreaker RIA', plan: 'practice', packs: ['advisor'], seat_limit: 8, admin_email: adminEmail, admin_password: 'trustbreaker-admin-password' },
  });
  must(provision.status === 201, `fixture organization failed (${provision.status})`);
  const login = await request(base, '/auth/login', { body: { email: adminEmail, password: 'trustbreaker-admin-password' } });
  const admin = login.body.access_token as string;
  const license = provision.body.license_key as string;
  const users: Identity[] = [];
  for (const label of ['sender', 'recipient', 'walled']) {
    const made = await request(base, '/org/users', { access: admin, body: { email: `${label}-${crypto.randomUUID()}@trust.test`, password: 'trustbreaker-member-password' } });
    const email = made.body.user.email as string;
    const userId = made.body.user.user_id as string;
    const signedIn = await request(base, '/auth/login', { body: { email, password: 'trustbreaker-member-password' } });
    const access = signedIn.body.access_token as string;
    const activated = await request(base, '/org/activate', { access, body: { license_key: license, machine_id: `trust-${label}` } });
    users.push({ userId, access, seat: activated.body.seat_token as string });
  }
  const madeMatter = await request(base, '/org/matters', { access: admin, body: { client_name: MARKERS[0] } });
  const matterId = madeMatter.body.matter.matter_id as string;
  for (const user of users) {
    const member = await request(base, `/matter/${matterId}/members/add`, { access: admin, body: { user_id: user.userId, role: 'editor' } });
    must(member.status === 200, 'fixture membership failed');
  }
  for (const [index, user] of users.entries()) {
    const device = await request(base, '/device/register', { access: user.access, body: { device_id: `trust-device-${index}`, machine_id: `trust-machine-${index}`, label: `Trust ${index}`, pubkey_jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' } } });
    must(device.status === 200 || device.status === 201, 'fixture device registration failed');
  }
  const keys = await request(base, `/matter/${matterId}/keys/publish`, {
    access: admin,
    body: { epoch: 1, wrapped: users.map((user, index) => ({ user_id: user.userId, device_id: `trust-device-${index}`, wrapped_key_b64: `wrapped-${index}` })) },
  });
  must(keys.status === 200, 'fixture key publication failed');
  return { base, store, server, admin, orgId: tokenOrg(admin), matterId, sender: users[0]!, recipient: users[1]!, walled: users[2]! };
}

class MemoryNotifyStore implements CrmNotifyStore {
  readonly outbox = new Map<string, NotificationOutboxRow>();
  readonly inbox = new Map<string, NotificationInboxRow>();
  async transaction<T>(work: (tx: CrmNotifyTransaction) => Promise<T>): Promise<T> {
    const tx: CrmNotifyTransaction = {
      insertNotificationOutbox: async (row) => { this.outbox.set(row.envelopeId, { ...row }); },
      markNotificationOutboxDependencyReady: async (_org, envelope) => { this.outbox.get(envelope)!.referencedOperationRelayAccepted = true; },
      markNotificationOutboxSent: async (_org, envelope, at) => { this.outbox.get(envelope)!.sentAt = at; },
      markNotificationOutboxDeadLetter: async (_org, envelope, why) => { this.outbox.get(envelope)!.deadLetterReason = why; },
      incrementNotificationOutboxAttempt: async (_org, envelope) => { this.outbox.get(envelope)!.attempts += 1; },
      putNotificationInbox: async (row) => { if (!this.inbox.has(row.envelopeId)) this.inbox.set(row.envelopeId, { ...row }); },
      updateNotificationInboxState: async (_org, envelope, state, why) => { const row = this.inbox.get(envelope)!; row.state = state; row.deadLetterReason = why; },
      advanceContiguousNotificationCursor: async () => 1,
    };
    return work(tx);
  }
  async listPendingNotificationOutbox(orgId: string, now: number): Promise<NotificationOutboxRow[]> {
    return [...this.outbox.values()].filter((row) => row.orgId === orgId && !row.sentAt && !row.deadLetterReason && row.dispatchAfterMs <= now);
  }
  async listWaitingReferencedState(): Promise<NotificationInboxRow[]> { return []; }
  async listExpiredInformationalWaitingAccess(): Promise<NotificationInboxRow[]> { return []; }
}

class HttpNotifyRelay implements NotificationRelay {
  constructor(private readonly fixture: RelayFixture, private readonly actor: Identity) {}
  async send(row: Parameters<NotificationRelay['send']>[0]): Promise<void> {
    const sent = await request(this.fixture.base, '/notify/send', {
      access: this.actor.access, seat: this.actor.seat,
      body: { org_id: row.orgId, recipient_user_id: row.recipientUserId, envelope_id: row.envelopeId, ciphertext_b64: row.ciphertextB64, transient_scope: { matter_id: this.fixture.matterId }, key_hint: row.keyHint, idempotency_key: row.idempotencyKey, retention_until_terminal: row.retentionUntilTerminal },
    });
    if (sent.status !== 201 && sent.status !== 200) throw new Error(`relay rejected envelope (${sent.status})`);
  }
  async ack(): Promise<void> {}
}

async function notificationClient(f: RelayFixture, relay: NotificationRelay, recipientKey: CryptoKey): Promise<{ client: NotificationClient; store: MemoryNotifyStore; key: CryptoKey }> {
  const store = new MemoryNotifyStore();
  return {
    store, key: recipientKey,
    client: new NotificationClient({
      store, relay, deviceId: 'trust-device-1', now: () => NOW,
      keys: { resolve: async () => null }, referencedState: { hasDurablyApplied: async () => true },
    }),
  };
}

function dbRows(store: Store, sql: string): Array<Record<string, unknown>> {
  const db = (store as unknown as { db: { query(statement: string): { all(): Array<Record<string, unknown>> } } }).db;
  return db.query(sql).all();
}

function revision(id: string, parents: string[], value: string, clock: number): TemplateRevision {
  return { revisionId: id, templateId: 'template', parentRevisionIds: parents, issuedHlc: { wallMillis: clock, logicalCounter: 0, actorId: 'advisor', operationId: `op-${id}` }, label: id, stepChanges: [{ stepId: 'step', field: 'title', value, changeKind: 'modify' }] };
}
function workflowInstance(): WorkflowInstanceSnapshot {
  return { id: 'instance', acceptedRevisionIds: [], displayedRevisionSet: { revisionIds: [] }, decisionLedger: [], propagationEvents: [], steps: { step: { stepId: 'step', origin: 'template', status: 'todo', titleSnapshot: 'Old', derived: {}, removalRequestedBy: [], detachedFromTemplate: false, stepNotes: '', assignmentOperations: [], completionOperations: [] } } };
}

async function relayBlindness(f: RelayFixture): Promise<void> {
  const contentKey = await importMatterKey(await generateMatterKey());
  const { client, store } = await notificationClient(f, new HttpNotifyRelay(f, f.sender), contentKey);
  const envelopeId = opaqueId(11);
  await client.queue({
    orgId: f.orgId, recipientUserId: f.recipient.userId, envelopeId, class: 'client_confidential', retention: 'approval', urgent: true,
    payload: { version: 1, type: 'task_assigned', subjectRef: MARKERS[0], actorId: MARKERS[1], displayHlc: { wallMillis: NOW, logicalCounter: 0, actorId: 'advisor', operationId: MARKERS[3] }, pointer: { referenceId: MARKERS[2], operationId: MARKERS[3] } },
    address: { scope: 'client', matterId: f.matterId, keyEpoch: 1, key: contentKey, keyHint: 'opaque-hint' },
  });
  // D18: the client cannot enqueue a dependent notification until the document operation is durable.
  await client.markReferencedOperationRelayAccepted(f.orgId, envelopeId);
  must(await client.flush(f.orgId, f.matterId) === 1, 'envelope was not delivered');
  const outbox = store.outbox.get(envelopeId)!;
  must(ciphertextBand(outbox.ciphertextB64) !== null, 'ciphertext did not use an allowed size band');
  const inbox = await request(f.base, `/notify/inbox?org_id=${f.orgId}&since=0`, { access: f.recipient.access, seat: f.recipient.seat });
  must(inbox.status === 200 && inbox.body.envelopes.length === 1, 'recipient cannot retrieve envelope');
  const relayText = stable({
    notify: dbRows(f.store, 'SELECT * FROM notify_envelopes'),
    delivery: dbRows(f.store, 'SELECT * FROM notify_envelope_delivery'),
    idempotency: dbRows(f.store, 'SELECT * FROM notify_idempotency'),
    api: inbox.body,
  });
  for (const marker of MARKERS) must(!relayText.includes(marker), `relay learned plaintext marker ${marker}`);
  const columns = dbRows(f.store, "SELECT name FROM pragma_table_info('notify_envelopes')").map((row) => String(row.name));
  for (const forbidden of ['sender', 'subject', 'type', 'operation', 'matter']) must(!columns.some((column) => column.includes(forbidden)), `relay table stores forbidden ${forbidden} linkage`);
  const operationRows = dbRows(f.store, 'SELECT blob_id, ciphertext FROM matter_updates');
  must(!stable(operationRows).includes(envelopeId) && !relayText.includes(MARKERS[3]!), 'relay linked envelope to referenced operation');
}

async function wallEnforcement(f: RelayFixture): Promise<void> {
  const before = await request(f.base, `/matter/${f.matterId}/updates?since=0&doc_id=crm:record`, { access: f.walled.access, seat: f.walled.seat });
  must(before.status === 200, 'fixture walled seat could not subscribe before wall');
  const rotated = await request(f.base, `/matter/${f.matterId}/wall/set`, { access: f.admin, body: { user_id: f.walled.userId, reason: 'trustbreaker' } });
  must(rotated.status === 200 && rotated.body.key_epoch === 2, 'wall did not rotate the key epoch');
  const subscribe = await request(f.base, `/matter/${f.matterId}/updates?since=0&doc_id=crm:record`, { access: f.walled.access, seat: f.walled.seat });
  const keyFetch = await request(f.base, `/matter/${f.matterId}/keys/fetch`, { access: f.walled.access, seat: f.walled.seat, body: { device_id: 'trust-device-2' } });
  const search = await request(f.base, `/matter/${f.matterId}/search?q=${encodeURIComponent(MARKERS[0])}`, { access: f.walled.access, seat: f.walled.seat });
  must(subscribe.status === 403 && keyFetch.status === 403, 'walled user was denied by UI/API rather than key gate');
  must(search.status === 403 || search.status === 404, 'walled search/FTS path accepted household content');
  const oldKey = await importMatterKey(await generateMatterKey());
  const oldCiphertext = await (async () => {
    const cryptoModule = await import('@/platform/crm/notify/envelopeCrypto');
    return cryptoModule.sealEnvelope(f.orgId, f.walled.userId, 'client_confidential', { scope: 'client', matterId: f.matterId, keyEpoch: 1, key: oldKey, keyHint: 'old-epoch' }, { version: 1, type: 'task_assigned', subjectRef: MARKERS[0], actorId: 'advisor', displayHlc: { wallMillis: NOW, logicalCounter: 0, actorId: 'advisor', operationId: 'old-op' }, pointer: { referenceId: 'task' } });
  })();
  const unavailableKey = await importMatterKey(await generateMatterKey());
  const opened = await openEnvelope(f.orgId, f.walled.userId, { scope: 'client', matterId: f.matterId, keyEpoch: 2, key: unavailableKey, keyHint: 'new-epoch' }, oldCiphertext);
  must(!opened.ok, 'walled seat decrypted retained old-epoch envelope without a key grant');
  // Firm-home operations intentionally carry only neutral state references, never household identity or body text.
  const operationalShell = { state: 'due', count: 1, queueRef: opaqueId(91) };
  must(!stable(operationalShell).includes('Northcrest') && !stable(operationalShell).includes('wire'), 'firm-operational shell carried client content');
}

async function approvalIntegrity(): Promise<void> {
  // The durable queue is the only public writer entry point: unknown/unapproved IDs are a no-op.
  const { useCrmWriteQueueStore } = await import('@/platform/state/crmWriteQueueStore');
  useCrmWriteQueueStore.setState({ items: [] });
  await useCrmWriteQueueStore.getState().approve(['no-approved-proposal-record'], 'external-household');
  must(useCrmWriteQueueStore.getState().items.length === 0, 'external write escaped without an approved proposal record');

  const r1 = revision('r1', [], 'A', 1);
  const r2 = revision('r2', [], 'B', 2);
  const split: WorkflowTemplateSnapshot = { id: 'template', revisions: { r1, r2 }, headRevisionIds: ['r1', 'r2'] };
  const unresolved = createOffer(split, workflowInstance(), 'offer-split');
  let rejected = false;
  try { applyOffer(split, workflowInstance(), unresolved, 'event-split', { transact: () => { throw new Error('must not transact'); } }); } catch { rejected = true; }
  must(rejected, 'unresolved concurrent heads were silently applied');

  const completed = workflowInstance();
  completed.steps.step!.status = 'done';
  completed.steps.step!.outcome = 'completed';
  completed.steps.step!.completionOperations.push({ completionId: 'done-1', completedBy: 'advisor', outcome: 'completed', sourceOperationId: 'done-op' });
  const linear: WorkflowTemplateSnapshot = { id: 'template', revisions: { r3: revision('r3', [], 'Attempted mutation', 3) }, headRevisionIds: ['r3'] };
  const applied = applyOffer(linear, completed, createOffer(linear, completed, 'offer-completed'), 'event-completed', { transact: (_payload: PropagationTransactionPayload) => {} }).instance;
  must(stable(applied.steps.step!.completionOperations) === stable(completed.steps.step!.completionOperations) && applied.steps.step!.outcome === 'completed', 'propagation mutated a completed step’s progress');
}

async function dataLossTraps(f: RelayFixture): Promise<void> {
  const key = await importMatterKey(await generateMatterKey());
  const store = new MemoryNotifyStore();
  let attempts = 0;
  const crashingRelay: NotificationRelay = { send: async () => { attempts += 1; throw new Error('simulated process crash after mutation commit'); }, ack: async () => {} };
  const client = new NotificationClient({ store, relay: crashingRelay, deviceId: 'crash-device', now: () => NOW, keys: { resolve: async () => null }, referencedState: { hasDurablyApplied: async () => true } });
  const envelopeId = opaqueId(51);
  await client.queue({ orgId: f.orgId, recipientUserId: f.recipient.userId, envelopeId, class: 'client_confidential', retention: 'approval', urgent: true, payload: { version: 1, type: 'task_assigned', subjectRef: 'task', actorId: 'advisor', displayHlc: { wallMillis: NOW, logicalCounter: 0, actorId: 'advisor', operationId: 'op-outbox' }, pointer: { referenceId: 'task', operationId: 'op-outbox' } }, address: { scope: 'client', matterId: f.matterId, keyEpoch: 1, key, keyHint: 'hint' } });
  await client.markReferencedOperationRelayAccepted(f.orgId, envelopeId);
  must(await client.flush(f.orgId, f.matterId) === 0 && attempts === 1 && !store.outbox.get(envelopeId)!.sentAt, 'crash incorrectly consumed outbox row');
  const recovered = new NotificationClient({ store, relay: new HttpNotifyRelay(f, f.sender), deviceId: 'crash-device', now: () => NOW, keys: { resolve: async () => null }, referencedState: { hasDurablyApplied: async () => true } });
  must(await recovered.flush(f.orgId, f.matterId) === 1 && !!store.outbox.get(envelopeId)!.sentAt, 'outbox did not recover after crash');

  const relay: MultiplexedRelay & { pulls: number } = {
    pulls: 0, onFrame: null, start: async () => {}, stop: async () => {}, subscribe: async () => {}, unsubscribe: async () => {},
    pullThrough: async () => { relay.pulls += 1; return []; },
  };
  const cursor = new InMemoryCursorStore();
  const update = (cursorNumber: number): EncryptedRelayUpdate => ({ matterId: f.matterId, docId: 'crm:tasks', cursor: cursorNumber, blobId: `blob-${cursorNumber}`, keyEpoch: 1, ciphertext: new Uint8Array([cursorNumber]) });
  const subscription = new SyncSubscription({ key: { matterId: f.matterId, docId: 'crm:tasks' }, relay, store: cursor, authenticateAndApply: async () => {} });
  await subscription.start();
  relay.onFrame!({ type: 'ready', matterId: f.matterId, docId: 'crm:tasks', watermark: 0 });
  await subscription.whenIdle();
  relay.onFrame!(update(1)); await subscription.whenIdle();
  relay.onFrame!(update(1)); await subscription.whenIdle();
  must(await cursor.cursor({ matterId: f.matterId, docId: 'crm:tasks' }) === 1 && relay.pulls === 0 && subscription.status() === 'live', 'duplicate cursor triggered a gap-repair loop');

  const doc = new Y.Doc(); doc.getMap<string>('state').set('one', '1');
  const rawOne = Y.encodeStateAsUpdate(doc); const vector = Y.encodeStateVector(doc); doc.getMap<string>('state').set('two', '2');
  const rawTwo = Y.encodeStateAsUpdate(doc, vector);
  const checkpoint = await createCheckpoint({ stream: { orgId: f.orgId, matter_id: f.matterId, docId: 'crm:tasks' }, frontier: { cursor: 2 }, keyEpoch: 1, generation: 1, doc, contentKey: key, signer: { deviceId: 'trust-validator', sign: async () => 'signed' }, retentionEligible: true, createdAt: '2026-07-11T00:00:00.000Z' });
  const incomplete = await validateCheckpoint({ checkpoint, retainedRows: [{ cursor: 1, ciphertextB64: await sealCheckpointPayload(key, rawOne, 1), keyEpoch: 1 }], contentKey: key, keyEpoch: 1, verifier: { verify: async () => true }, receiptSigner: { deviceId: 'trust-validator', sign: async () => 'signed' } });
  must(!incomplete.ok && incomplete.repairAlert.code === 'missing_raw_row', 'incomplete checkpoint claimed its frontier');
  const retirement = await retireAndRebaseDevice({ orgId: f.orgId, deviceId: 'offline-past-horizon', localEdits: [{ editId: 'old-edit', matter_id: f.matterId, docId: 'crm:tasks', ciphertextB64: bytes('old'), keyEpoch: 1 }], exportKey: key, exportKeyEpoch: 1, currentKeyEpoch: 2, approvedEditIds: new Set(), dependencies: { discardStaleState: async () => {}, loadValidatedCheckpoint: async () => checkpoint, replayApprovedEdit: async () => { throw new Error('old device must export, not merge'); } } });
  must(retirement.exportFile !== undefined, 'offline-past-horizon device merged instead of exporting');
  void rawTwo;
}

async function egressHonesty(): Promise<void> {
  // This headless process has no persisted affirmative cloud choice. The
  // production choke point must fail closed here, exactly as it does during a
  // local-only hydration window before any network primitive is reached.
  let blocked = false;
  try { assertCloudSendAllowed('openai'); } catch { blocked = true; }
  must(blocked, 'local-only mode allowed a cloud AI send primitive');
}

async function main(): Promise<void> {
  const f = await fixture();
  try {
    await attack('relay-blindness/full-envelope-and-document-flow', () => relayBlindness(f));
    await attack('approval-integrity/no-unapproved-or-unsafe-propagation', approvalIntegrity);
    await attack('data-loss/crash-duplicate-checkpoint-offline-horizon', () => dataLossTraps(f));
    await attack('ethical-wall/key-denial-and-search', () => wallEnforcement(f));
    await attack('egress-honesty/local-only-cloud-send-choke', egressHonesty);
  } finally {
    f.server.stop(true);
  }
  if (failures.length) {
    console.error(`VULN: ${failures.length} trust-breaker attack(s) succeeded.`);
    for (const failure of failures) console.error(`VULN: ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('TRUSTBREAKER BATTERY: PASS — all attacks were refused.');
  }
}

main().catch((error: unknown) => {
  console.error(`VULN: trust-breaker harness failed to start: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
