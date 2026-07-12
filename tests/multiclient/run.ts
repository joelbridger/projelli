/**
 * Multi-client collaboration harness.
 *
 * This is deliberately a standalone Bun program, rather than a mocked unit
 * test: it starts the real relay in a child process and connects independent
 * MatterDocSyncClient instances to it over its real HTTP and WebSocket routes.
 *
 * Run with: npm run test:multiclient
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import * as Y from 'yjs';
import { MatterDocSyncClient } from '@/platform/firm/coedit/MatterDocSyncClient';
import { generateMatterKey } from '@/platform/firm/matterCrypto';
import type { FirmApiClient } from '@/platform/firm/FirmApiClient';
import type {
  PullUpdatesResponse,
  PushUpdateResponse,
  SyncTicketResponse,
} from '@/platform/firm/contract';
import type { WebSocketLike } from '@/platform/firm/MatterSyncClient';

/** Six seats is the frozen small-RIA campaign scenario (§2). */
export const CLIENT_COUNT = 6;
export const TIMEOUT_MS = 12_000;
export const POLL_MS = 20;
type RelayProcess = ChildProcessByStdio<null, Readable, Readable>;

export interface JsonResponse {
  [key: string]: unknown;
}

export interface Identity {
  readonly accessToken: string;
  readonly seatToken: string;
  readonly userId: string;
}

export interface HeadlessClient {
  readonly name: string;
  readonly doc: Y.Doc;
  readonly sync: MatterDocSyncClient;
}

interface ScenarioReport {
  readonly clients: number;
  readonly state: string;
  readonly stateHash: string;
  readonly onlineLatencyMs: readonly number[];
  readonly issuedEdits: number;
}

export class RelayHttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string
  ) {}

  private async request(
    pathname: string,
    init: RequestInit
  ): Promise<JsonResponse> {
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        ...(init.headers ?? {}),
      },
    });
    const body = (await response.json().catch(() => ({}))) as JsonResponse;
    if (!response.ok) {
      throw new Error(
        `Relay request ${init.method ?? 'GET'} ${pathname} failed (${response.status}): ${JSON.stringify(body)}`
      );
    }
    return body;
  }

  async pushUpdate(
    matterId: string,
    blobId: string,
    ciphertextB64: string,
    seatToken: string,
    keyEpoch = 1,
    docId = '_notes'
  ): Promise<PushUpdateResponse> {
    return (await this.request(
      `/matter/${encodeURIComponent(matterId)}/updates`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          blob_id: blobId,
          ciphertext_b64: ciphertextB64,
          seat_token: seatToken,
          key_epoch: keyEpoch,
          doc_id: docId,
        }),
      }
    )) as unknown as PushUpdateResponse;
  }

  async pullUpdates(
    matterId: string,
    since: number,
    seatToken: string,
    docId = '_notes'
  ): Promise<PullUpdatesResponse> {
    const query = new URLSearchParams({ since: String(since), doc_id: docId });
    return (await this.request(
      `/matter/${encodeURIComponent(matterId)}/updates?${query}`,
      {
        method: 'GET',
        headers: { 'x-seat-token': seatToken },
      }
    )) as unknown as PullUpdatesResponse;
  }

  async createSyncTicket(
    matterId: string,
    seatToken: string
  ): Promise<SyncTicketResponse> {
    return (await this.request(
      `/matter/${encodeURIComponent(matterId)}/sync-ticket`,
      {
        method: 'POST',
        headers: { 'x-seat-token': seatToken },
      }
    )) as unknown as SyncTicketResponse;
  }
}

function assertPresent<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null || value === '')
    throw new Error(`Harness setup did not receive ${label}.`);
  return value;
}

export async function jsonRequest(
  baseUrl: string,
  pathname: string,
  body: unknown,
  bearer?: string
): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as JsonResponse;
  if (!response.ok)
    throw new Error(
      `Setup request POST ${pathname} failed (${response.status}): ${JSON.stringify(json)}`
    );
  return json;
}

export async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a local relay port.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

export async function waitForRelay(
  baseUrl: string,
  process: RelayProcess,
  output: () => string
): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(
        `Relay stopped before it was ready (exit ${process.exitCode}).\n${output()}`
      );
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {
      // The process is still binding its local port.
    }
    await pause(POLL_MS);
  }
  throw new Error(
    `Relay did not become ready within ${TIMEOUT_MS}ms.\n${output()}`
  );
}

export function startRelay(
  port: number,
  dataDir: string
): { process: RelayProcess; output: () => string } {
  const lines: string[] = [];
  const child = spawn('bun', ['run', 'src/server.ts'], {
    cwd: path.resolve(process.cwd(), 'backend'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      HOST: '127.0.0.1',
      DB_PATH: path.join(dataDir, 'relay.sqlite'),
      AUTH_SECRET: 'multiclient-harness-auth-secret-0123456789',
      MANAGED_KEY_SECRET: 'multiclient-harness-managed-secret-0123456789',
      AUTH_RATE_LIMIT_MAX: '1000',
      RELAY_RATE_LIMIT_MAX: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const record = (chunk: Buffer) => {
    lines.push(chunk.toString());
    if (lines.length > 40) lines.shift();
  };
  child.stdout.on('data', record);
  child.stderr.on('data', record);
  return { process: child, output: () => lines.join('').trim() };
}

export async function stopRelay(process: RelayProcess): Promise<void> {
  if (process.exitCode !== null) return;
  process.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (process.exitCode === null) process.kill('SIGKILL');
      resolve();
    }, 2_000);
    process.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

export function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function until(label: string, predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await pause(POLL_MS);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

export function materializedState(doc: Y.Doc): string {
  const content = doc.getMap<unknown>('shared-document');
  return JSON.stringify(
    Object.fromEntries(
      [...content.entries()].sort(([a], [b]) => a.localeCompare(b))
    )
  );
}

export function stateHash(value: string): string {
  let hash = 2_166_136_261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export async function createFirm(
  baseUrl: string
): Promise<{ matterId: string; identities: Identity[]; adminAccessToken: string; orgId: string }> {
  const runId = 'six-seat-fixture';
  const password = 'harness-member-password-123';
  const provision = await jsonRequest(baseUrl, '/admin/org', {
    name: `Harness Firm ${runId}`,
    plan: 'practice',
    packs: ['advisor'],
    seat_limit: CLIENT_COUNT + 1,
    admin_email: `admin-${runId}@harness.test`,
    admin_password: 'harness-admin-password-123',
  });
  const licenseKey = assertPresent(
    provision['license_key'] as string | undefined,
    'a license key'
  );
  const admin = provision['admin'] as JsonResponse | undefined;
  const adminEmail = assertPresent(
    admin?.['email'] as string | undefined,
    'the admin email'
  );
  const adminLogin = await jsonRequest(baseUrl, '/auth/login', {
    email: adminEmail,
    password: 'harness-admin-password-123',
  });
  const adminAccess = assertPresent(
    adminLogin['access_token'] as string | undefined,
    'the admin access token'
  );

  const identities: Identity[] = [];
  for (let index = 0; index < CLIENT_COUNT; index += 1) {
    const email = `client-${index}-${runId}@harness.test`;
    const created = await jsonRequest(
      baseUrl,
      '/org/users',
      { email, password },
      adminAccess
    );
    const createdUser = created['user'] as JsonResponse | undefined;
    const userId = assertPresent(
      createdUser?.['user_id'] as string | undefined,
      `client ${index + 1} user id`
    );
    const login = await jsonRequest(baseUrl, '/auth/login', {
      email,
      password,
    });
    const accessToken = assertPresent(
      login['access_token'] as string | undefined,
      `client ${index + 1} access token`
    );
    const activation = await jsonRequest(
      baseUrl,
      '/org/activate',
      {
        license_key: licenseKey,
        machine_id: `harness-client-${index}-${runId}`,
      },
      accessToken
    );
    identities.push({
      userId,
      accessToken,
      seatToken: assertPresent(
        activation['seat_token'] as string | undefined,
        `client ${index + 1} seat token`
      ),
    });
  }

  const matter = await jsonRequest(
    baseUrl,
    '/org/matters',
    { client_name: 'Northcrest Harness Household' },
    adminAccess
  );
  const matterBody = matter['matter'] as JsonResponse | undefined;
  const matterId = assertPresent(
    matterBody?.['matter_id'] as string | undefined,
    'the shared matter id'
  );
  for (const identity of identities) {
    await jsonRequest(
      baseUrl,
      `/matter/${encodeURIComponent(matterId)}/members/add`,
      {
        user_id: identity.userId,
        role: 'editor',
      },
      adminAccess
    );
  }
  const orgId = assertPresent((JSON.parse(Buffer.from(adminAccess.split('.')[1] ?? '', 'base64url').toString('utf8')) as JsonResponse)['org_id'] as string | undefined, 'the organization id');
  return { matterId, identities, adminAccessToken: adminAccess, orgId };
}

function localSocketFactory(baseUrl: string): (url: string) => WebSocketLike {
  const wsBase = baseUrl.replace(/^http/i, 'ws');
  return (ticketedUrl) => {
    const remotePath = new URL(ticketedUrl);
    return new WebSocket(
      `${wsBase}${remotePath.pathname}${remotePath.search}`
    ) as unknown as WebSocketLike;
  };
}

export async function createHeadlessClients(
  baseUrl: string,
  matterId: string,
  identities: readonly Identity[]
): Promise<HeadlessClient[]> {
  const keyB64 = await generateMatterKey();
  return identities.map((identity, index) => {
    const doc = new Y.Doc();
    const relayClient = new RelayHttpClient(baseUrl, identity.accessToken);
    const sync = new MatterDocSyncClient({
      matterId,
      docId: 'shared-doc-harness',
      doc,
      keyB64,
      keyEpoch: 1,
      seatToken: identity.seatToken,
      client: relayClient as unknown as FirmApiClient,
      socketFactory: localSocketFactory(baseUrl),
    });
    return { name: `client-${index + 1}`, doc, sync };
  });
}

async function runScenario(
  clients: readonly HeadlessClient[]
): Promise<ScenarioReport> {
  if (clients.length !== CLIENT_COUNT)
    throw new Error(
      `Expected ${CLIENT_COUNT} clients, received ${clients.length}.`
    );
  await Promise.all(clients.map(({ sync }) => sync.start()));

  const [
    advisor,
    associateOne,
    associateTwo,
    operations,
    supportOne,
    supportTwo,
  ] = clients;
  if (
    !advisor ||
    !associateOne ||
    !associateTwo ||
    !operations ||
    !supportOne ||
    !supportTwo
  ) {
    throw new Error(
      'The six-seat scenario did not receive all required clients.'
    );
  }
  let issuedEdits = 0;
  const edit = (client: HeadlessClient, field: string, value: string): void => {
    client.doc.getMap<unknown>('shared-document').set(field, value);
    issuedEdits += 1;
  };

  edit(advisor, 'title', 'Northcrest annual review');
  await until('the initial document to reach all clients', () =>
    clients.every((client) =>
      materializedState(client.doc).includes('Northcrest annual review')
    )
  );

  // Scripted day 1: all six seats change different Task fields concurrently.
  // This uses the existing Yjs sync engine until the CRM Task driver lands.
  const concurrentStartedAt = Date.now();
  edit(advisor, 'assigneeUserId', 'client-2');
  edit(associateOne, 'due', '2026-07-18');
  edit(associateTwo, 'priority', 'high');
  edit(operations, 'body', 'Prepare the Northcrest review packet.');
  edit(supportOne, 'status', 'in-review');
  edit(supportTwo, 'title', 'Northcrest annual review — ready for sign-off');
  await until('all six concurrent task-field edits to converge', () => {
    const states = clients.map((client) => materializedState(client.doc));
    return (
      states.every((state) => state === states[0]) &&
      states[0]?.includes('"status":"in-review"') === true &&
      states[0]?.includes('"assigneeUserId":"client-2"') === true
    );
  });
  const concurrentLatency = Date.now() - concurrentStartedAt;

  // Scripted day 2: two seats go offline while the other four issue ten
  // non-overlapping changes. Their Y.Docs remain intact while sync is stopped.
  associateTwo.sync.stop();
  supportTwo.sync.stop();
  const onlineEditors = [advisor, associateOne, operations, supportOne];
  for (let index = 0; index < 10; index += 1) {
    edit(
      onlineEditors[index % onlineEditors.length]!,
      `offlineReturnField${index + 1}`,
      `change-${index + 1}`
    );
  }
  const onlineStartedAt = Date.now();
  await until(
    'the four online clients to converge while two seats are offline',
    () => {
      const states = onlineEditors.map((client) =>
        materializedState(client.doc)
      );
      return (
        states.every((state) => state === states[0]) &&
        states[0]?.includes('"offlineReturnField10":"change-10"') === true
      );
    }
  );
  const onlineLatency = Date.now() - onlineStartedAt;

  await Promise.all([associateTwo.sync.start(), supportTwo.sync.start()]);
  const expectedFields = [
    'assigneeUserId',
    'body',
    'due',
    'offlineReturnField10',
    'priority',
    'status',
    'title',
  ];
  await until('all six clients to converge after the two seats rejoin', () => {
    const states = clients.map((client) => materializedState(client.doc));
    return (
      states.every((state) => state === states[0]) &&
      expectedFields.every(
        (field) => states[0]?.includes(`"${field}"`) === true
      )
    );
  });

  const state = materializedState(advisor.doc);
  const allStates = clients.map((client) => materializedState(client.doc));
  if (!allStates.every((candidate) => candidate === state)) {
    throw new Error(`Convergence failed: ${JSON.stringify(allStates)}`);
  }

  // Compare only this document, which all six seats are authorized and
  // subscribed to. CRM drivers will add real local-store absence checks.
  if (
    allStates.some((candidate) =>
      candidate.includes('Northcrest-walled-client-secret')
    )
  ) {
    throw new Error(
      'A document outside this authorized/subscribed scenario leaked into a client view.'
    );
  }

  // WAVE-PENDING: B1/B3 — real crm:record and crm:task-notes drivers, local
  // storage/search/projection/rendered-view absence checks, envelopes, workflow
  // propagation, and seventh-seat bootstrap. Keep these CRM-specific scripts
  // out of MatterDocSyncClient so the real-relay harness stays runnable.
  return {
    clients: clients.length,
    state,
    stateHash: stateHash(state),
    onlineLatencyMs: [concurrentLatency, onlineLatency],
    issuedEdits,
  };
}

function percentile(
  samples: readonly number[],
  percentileValue: number
): number {
  const ordered = [...samples].sort((a, b) => a - b);
  const index = Math.max(
    0,
    Math.ceil((percentileValue / 100) * ordered.length) - 1
  );
  return ordered[index] ?? 0;
}

async function main(): Promise<void> {
  const workDir = await mkdtemp(path.join(tmpdir(), 'lantern-multiclient-'));
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const relay = startRelay(port, workDir);
  const clients: HeadlessClient[] = [];
  try {
    await waitForRelay(baseUrl, relay.process, relay.output);
    const firm = await createFirm(baseUrl);
    clients.push(
      ...(await createHeadlessClients(baseUrl, firm.matterId, firm.identities))
    );
    const report = await runScenario(clients);
    console.log('MULTICLIENT HARNESS: PASS');
    console.log(
      `scenario: ${report.clients} seats made six concurrent task-field edits; two seats went offline, then rejoined`
    );
    console.log(
      `convergence: ${report.clients}/${report.clients} identical materialized states (hash ${report.stateHash})`
    );
    console.log(`state: ${report.state}`);
    console.log(
      `issued edits reflected in the shared authorized/subscribed document: ${report.issuedEdits}`
    );
    console.log(
      `online edit latency (reported, not gated): p50=${percentile(report.onlineLatencyMs, 50)}ms p95=${percentile(report.onlineLatencyMs, 95)}ms`
    );
  } finally {
    for (const client of clients) client.sync.stop();
    await stopRelay(relay.process);
    await rm(workDir, { recursive: true, force: true });
  }
}

if (import.meta.main) main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error('MULTICLIENT HARNESS: FAIL');
  console.error(message);
  process.exitCode = 1;
});
