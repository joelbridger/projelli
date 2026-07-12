/**
 * MatterSyncClient — the E2EE collaboration payoff.
 *
 * We stand up an in-process FAKE RELAY that behaves like the backend's dumb
 * pipe: it stores opaque base64 ciphertext blobs keyed by matter, hands them
 * back on pull, and fans them out to connected fake sockets. It NEVER decrypts.
 *
 * Then two MatterSyncClient instances sharing the SAME matter key edit their
 * own Yjs docs; we assert:
 *   1. The relay only ever held ciphertext (the plaintext never appears in any
 *      stored blob) — proven by scanning the relay's store for a sentinel.
 *   2. The two clients CONVERGE: each one's edit shows up in the other's Yjs
 *      doc after the encrypted update round-trips through the relay.
 */

import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { MatterSyncClient, type WebSocketLike } from '@/platform/firm/MatterSyncClient';
import { encryptUpdateV2, generateMatterKey, importMatterKey } from '@/platform/firm/matterCrypto';
import type { PushUpdateResponse, PullUpdatesResponse } from '@/platform/firm/contract';
import type { MatterHandle, StreamHandle } from '@/platform/firm/contract';

const MATTER = `mh2_${'m'.repeat(43)}` as MatterHandle;
const NOTES_STREAM = `sh2_${'n'.repeat(43)}` as StreamHandle;
const DOC_STREAM = `sh2_${'d'.repeat(43)}` as StreamHandle;

// firmConfig.getMatterSyncSocketUrl is called by the client but we inject a
// socket factory, so the URL itself is unused by the fake. No network.

interface StoredBlob {
  cursor: number;
  blob_id: string;
  key_epoch: number;
  ciphertext_b64: string;
}

/** A fake relay: stores opaque blobs, fans out to connected sockets. */
class FakeRelay {
  blobs: StoredBlob[] = [];
  private seq = 0;
  private sockets: FakeSocket[] = [];
  keyEpoch = 1;

  push(blobId: string, ciphertextB64: string, keyEpoch: number): PushUpdateResponse {
    const existing = this.blobs.find((b) => b.blob_id === blobId);
    if (existing) {
      return { ok: true, cursor: existing.cursor, blob_id: blobId, key_epoch: this.keyEpoch, duplicate: true };
    }
    this.seq += 1;
    const stored: StoredBlob = { cursor: this.seq, blob_id: blobId, key_epoch: keyEpoch, ciphertext_b64: ciphertextB64 };
    this.blobs.push(stored);
    // Fan out to every connected socket as an `update` frame.
    for (const s of this.sockets) {
      s.deliver({
        type: 'update',
        cursor: stored.cursor,
        blob_id: stored.blob_id,
        key_epoch: stored.key_epoch,
        author_seat: 'seat-x',
        created_at: new Date().toISOString(),
        ciphertext_b64: stored.ciphertext_b64,
      });
    }
    return { ok: true, cursor: stored.cursor, blob_id: blobId, key_epoch: this.keyEpoch, duplicate: false };
  }

  pull(since: number): PullUpdatesResponse {
    const updates = this.blobs
      .filter((b) => b.cursor > since)
      .map((b) => ({
        cursor: b.cursor,
        blob_id: b.blob_id,
        key_epoch: b.key_epoch,
        author_seat: 'seat-x',
        created_at: new Date().toISOString(),
        ciphertext_b64: b.ciphertext_b64,
      }));
    const latest = this.blobs.length ? this.blobs[this.blobs.length - 1]!.cursor : 0;
    return {
      key_epoch: this.keyEpoch,
      since,
      cursor: updates.length ? updates[updates.length - 1]!.cursor : since,
      latest_cursor: latest,
      has_more: false,
      updates,
    };
  }

  connect(socket: FakeSocket): void {
    this.sockets.push(socket);
    // Emit ready asynchronously (like a real WS open).
    queueMicrotask(() => {
      socket.open();
      socket.deliver({ type: 'ready', backlog: this.blobs.length, latest_cursor: this.seq, subscribers: 1 });
    });
  }
}

/** A minimal fake WebSocket the relay can push frames into. */
class FakeSocket implements WebSocketLike {
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  send(): void {
    /* relay ignores inbound frames; writes go via HTTP push */
  }
  close(): void {
    this.onclose?.({});
  }
  open(): void {
    this.onopen?.({});
  }
  deliver(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

/** A FirmApiClient stand-in exposing only what MatterSyncClient calls. */
function fakeClient(relay: FakeRelay) {
  return {
    pushUpdate: vi.fn(
      async (_matter: string, _stream: string, blobId: string, ct: string, _seat: string, epoch?: number) =>
        relay.push(blobId, ct, epoch ?? relay.keyEpoch),
    ),
    pullUpdates: vi.fn(async (_m: string, since: number) => relay.pull(since)),
    // Mint a fake single-use ticket — what MatterSyncClient fetches before it
    // opens the WS. The seat token is passed via the (mocked) HTTP call, not the
    // URL; the test asserts the WS URL carries only the ticket.
    createSyncTicket: vi.fn((...args: [string, string]) => {
      void args;
      return Promise.resolve({ ticket: `tkt_${Math.random().toString(36).slice(2)}`, expires_in_ms: 30_000 });
    }),
  } as unknown as import('@/platform/firm/FirmApiClient').FirmApiClient;
}

/** Wait until a predicate holds or time out (no real timers needed). */
async function until(pred: () => boolean, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (pred()) return;
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 2));
  }
}

/**
 * Wait for `pred` under `vi.useFakeTimers()`, advancing fake time in small
 * `stepMs` increments and yielding real microtasks between each step.
 * Needed because fake timers only control `setTimeout`/`setInterval` — real
 * async work in the code under test (WebCrypto ops, Promise chains) still
 * resolves on the REAL event loop, so under heavy parallel-test-run CPU
 * contention it can take many more real yields to settle than a single
 * `vi.advanceTimersByTimeAsync()` call provides. `maxSteps` bounds the total
 * simulated time advanced (`maxSteps * stepMs`) — keep it under whatever
 * fake-timer deadline (e.g. a scheduled backoff) the test must not race past.
 */
async function waitForFake(pred: () => boolean, maxSteps: number, stepMs: number): Promise<void> {
  for (let i = 0; i < maxSteps; i++) {
    if (pred()) return;
    await vi.advanceTimersByTimeAsync(stepMs);
    // Extra real microtask flushes per step for slow/contended test runs.
    await Promise.resolve();
    await Promise.resolve();
  }
}

/** Advance `steps * stepMs` of fake time unconditionally, in small steps
 * (same real-yield-per-step rationale as {@link waitForFake}), when a test
 * just needs to cross a deadline rather than wait for a predicate. */
async function advanceFake(steps: number, stepMs: number): Promise<void> {
  for (let i = 0; i < steps; i++) {
    await vi.advanceTimersByTimeAsync(stepMs);
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Task 7: doc_id partitioning test (MUST fail before the implementation)
// ---------------------------------------------------------------------------

interface StoredBlobWithStream extends StoredBlob {
  stream_handle: StreamHandle;
}

/**
 * A stream-handle-aware relay: stores blobs keyed by (blob_id, stream_handle),
 * fans out ONLY to sockets subscribed to the matching opaque stream handle.
 * on pull.
 */
class FakeDocRelay {
  blobs: StoredBlobWithStream[] = [];
  private seq = 0;
  /** stream_handle -> list of sockets subscribed to that encrypted stream */
  private sockets: Map<StreamHandle, FakeSocket[]> = new Map();
  keyEpoch = 1;

  push(blobId: string, ciphertextB64: string, keyEpoch: number, streamHandle: StreamHandle): PushUpdateResponse {
    const existing = this.blobs.find((b) => b.blob_id === blobId && b.stream_handle === streamHandle);
    if (existing) {
      return { ok: true, cursor: existing.cursor, blob_id: blobId, key_epoch: this.keyEpoch, duplicate: true };
    }
    this.seq += 1;
    const stored: StoredBlobWithStream = {
      cursor: this.seq,
      blob_id: blobId,
      key_epoch: keyEpoch,
      ciphertext_b64: ciphertextB64,
      stream_handle: streamHandle,
    };
    this.blobs.push(stored);
    const streamSockets = this.sockets.get(streamHandle) ?? [];
    for (const s of streamSockets) {
      s.deliver({
        type: 'update',
        cursor: stored.cursor,
        blob_id: stored.blob_id,
        key_epoch: stored.key_epoch,
        author_seat: 'seat-x',
        created_at: new Date().toISOString(),
        ciphertext_b64: stored.ciphertext_b64,
      });
    }
    return { ok: true, cursor: stored.cursor, blob_id: blobId, key_epoch: this.keyEpoch, duplicate: false };
  }

  pull(since: number, streamHandle: StreamHandle): PullUpdatesResponse {
    const updates = this.blobs
      .filter((b) => b.cursor > since && b.stream_handle === streamHandle)
      .map((b) => ({
        cursor: b.cursor,
        blob_id: b.blob_id,
        key_epoch: b.key_epoch,
        author_seat: 'seat-x',
        created_at: new Date().toISOString(),
        ciphertext_b64: b.ciphertext_b64,
      }));
    const allBlobs = this.blobs.filter((b) => b.stream_handle === streamHandle);
    const latest = allBlobs.length ? allBlobs[allBlobs.length - 1]!.cursor : 0;
    return {
      key_epoch: this.keyEpoch,
      since,
      cursor: updates.length ? updates[updates.length - 1]!.cursor : since,
      latest_cursor: latest,
      has_more: false,
      updates,
    };
  }

  connect(socket: FakeSocket, streamHandle: StreamHandle): void {
    if (!this.sockets.has(streamHandle)) this.sockets.set(streamHandle, []);
    this.sockets.get(streamHandle)!.push(socket);
    const allBlobs = this.blobs.filter((b) => b.stream_handle === streamHandle);
    const latest = allBlobs.length ? allBlobs[allBlobs.length - 1]!.cursor : 0;
    queueMicrotask(() => {
      socket.open();
      socket.deliver({ type: 'ready', backlog: allBlobs.length, latest_cursor: latest, subscribers: 1 });
    });
  }
}

function fakeDocClient(relay: FakeDocRelay, streamHandle: StreamHandle) {
  return {
    pushUpdate: vi.fn(
      async (_matter: string, _stream: StreamHandle, blobId: string, ct: string, _seat: string, epoch?: number) =>
        relay.push(blobId, ct, epoch ?? relay.keyEpoch, streamHandle),
    ),
    pullUpdates: vi.fn(async (_stream: StreamHandle, since: number) => relay.pull(since, streamHandle)),
    createSyncTicket: vi.fn((...args: [string, string]) => {
      void args;
      return Promise.resolve({ ticket: `tkt_${Math.random().toString(36).slice(2)}`, expires_in_ms: 30_000 });
    }),
  } as unknown as import('@/platform/firm/FirmApiClient').FirmApiClient;
}

describe('MatterSyncClient opaque stream partitioning', () => {
  it('two clients on the same matter but different stream handles do NOT receive each other\'s updates', async () => {
    const relay = new FakeDocRelay();
    const keyB64 = await generateMatterKey();

    const mkDocClient = (streamHandle: StreamHandle) =>
      new MatterSyncClient({
        matterHandle: MATTER,
        streamHandle,
        keyB64,
        keyEpoch: 1,
        seatToken: 'seat',
        accessToken: 'access',
        client: fakeDocClient(relay, streamHandle),
        socketFactory: () => {
          const s = new FakeSocket();
          relay.connect(s, streamHandle);
          return s;
        },
      });

    const notesClient = mkDocClient(NOTES_STREAM);
    const docAClient = mkDocClient(DOC_STREAM);

    await notesClient.start();
    await docAClient.start();

    // notesClient writes a note — should NOT appear in docAClient's doc.
    notesClient.doc.getMap('data').set('notes_key', 'notes_value');

    // docAClient writes — should NOT appear in notesClient's doc.
    docAClient.doc.getMap('data').set('doc_key', 'doc_value');

    // Wait for both writes to reach the relay (the push is async).
    await until(() => relay.blobs.some((b) => b.stream_handle === NOTES_STREAM));
    await until(() => relay.blobs.some((b) => b.stream_handle === DOC_STREAM));

    // Cross-contamination must NOT occur.
    expect(notesClient.doc.getMap('data').get('doc_key')).toBeUndefined();
    expect(docAClient.doc.getMap('data').get('notes_key')).toBeUndefined();

    const notesBlobs = relay.blobs.filter((b) => b.stream_handle === NOTES_STREAM);
    const docABlobs = relay.blobs.filter((b) => b.stream_handle === DOC_STREAM);
    expect(notesBlobs.length).toBeGreaterThan(0);
    expect(docABlobs.length).toBeGreaterThan(0);

    notesClient.stop();
    docAClient.stop();
  });

  it('clients on the same opaque stream converge and the relay carries no document ID', async () => {
    const relay = new FakeDocRelay();
    const keyB64 = await generateMatterKey();

    const a = new MatterSyncClient({
      matterHandle: MATTER,
      streamHandle: NOTES_STREAM,
      keyB64,
      keyEpoch: 1,
      seatToken: 'seat',
      accessToken: 'access',
      client: fakeDocClient(relay, NOTES_STREAM),
      socketFactory: () => {
        const s = new FakeSocket();
        relay.connect(s, NOTES_STREAM);
        return s;
      },
    });
    const b = new MatterSyncClient({
      matterHandle: MATTER,
      streamHandle: NOTES_STREAM,
      keyB64,
      keyEpoch: 1,
      seatToken: 'seat',
      accessToken: 'access',
      client: fakeDocClient(relay, NOTES_STREAM),
      socketFactory: () => {
        const s = new FakeSocket();
        relay.connect(s, NOTES_STREAM);
        return s;
      },
    });

    await a.start();
    await b.start();

    a.doc.getMap('m').set('x', 'hello');
    await until(() => b.doc.getMap('m').get('x') === 'hello');
    expect(b.doc.getMap('m').get('x')).toBe('hello');

    expect(relay.blobs.every((blob) => blob.stream_handle === NOTES_STREAM)).toBe(true);

    a.stop();
    b.stop();
  });
});

describe('MatterSyncClient E2EE convergence', () => {
  it('two clients converge on a Yjs doc; the relay only ever holds ciphertext', async () => {
    const relay = new FakeRelay();
    const keyB64 = await generateMatterKey(); // shared per-matter key (this chunk)
    const SENTINEL = 'PRIVILEGED_NOTE_SENTINEL_4a91c7';

    const mkClient = () =>
      new MatterSyncClient({
        matterHandle: MATTER,
        streamHandle: NOTES_STREAM,
        keyB64,
        keyEpoch: 1,
        seatToken: 'seat',
        accessToken: 'access',
        client: fakeClient(relay),
        socketFactory: () => {
          const s = new FakeSocket();
          relay.connect(s);
          return s;
        },
      });

    const a = mkClient();
    const b = mkClient();
    await a.start();
    await b.start();

    // Client A writes a value containing the sentinel into a shared Y.Map.
    a.doc.getMap('matter').set('note', SENTINEL);

    // Wait for the encrypted update to round-trip the relay into B's doc.
    await until(() => b.doc.getMap('matter').get('note') === SENTINEL);
    expect(b.doc.getMap('matter').get('note')).toBe(SENTINEL);

    // Client B writes back; A should converge too.
    b.doc.getMap('matter').set('status', 'reviewed');
    await until(() => a.doc.getMap('matter').get('status') === 'reviewed');
    expect(a.doc.getMap('matter').get('status')).toBe('reviewed');

    // The relay stored blobs, and NONE of them contains the plaintext sentinel
    // (it only ever saw opaque ciphertext).
    expect(relay.blobs.length).toBeGreaterThan(0);
    for (const blob of relay.blobs) {
      expect(blob.ciphertext_b64).not.toContain(SENTINEL);
      expect(atob(blob.ciphertext_b64)).not.toContain(SENTINEL);
    }

    // Both docs are byte-identical (full CRDT convergence).
    expect(Y.encodeStateAsUpdate(a.doc)).toEqual(Y.encodeStateAsUpdate(b.doc));

    a.stop();
    b.stop();
  });

  it('mints a ticket then opens the WS with ONLY the ticket (no token in the URL)', async () => {
    const relay = new FakeRelay();
    const keyB64 = await generateMatterKey();
    const SEAT = 'SEAT_TOKEN_SECRET_value';
    const ACCESS = 'ACCESS_TOKEN_SECRET_value';
    const client = fakeClient(relay);

    let wsUrl = '';
    const c = new MatterSyncClient({
      matterHandle: MATTER,
      streamHandle: NOTES_STREAM,
      keyB64,
      keyEpoch: 1,
      seatToken: SEAT,
      accessToken: ACCESS,
      client,
      socketFactory: (url: string) => {
        wsUrl = url; // capture exactly what the WS is opened with
        const s = new FakeSocket();
        relay.connect(s);
        return s;
      },
    });
    await c.start();
    await until(() => c.getStatus() === 'live');

    // A ticket was minted over the (authed) HTTP client before the socket opened.
    expect(client.createSyncTicket).toHaveBeenCalledTimes(1);
    // Arity-proof: the ticket now also binds the client's last-applied cursor so
    // the relay replays from there (the >500-update handoff data-loss fix).
    // Assert the arguments that carry the privacy invariant — the stream handle
    // and that the seat token travels in the call, never on the socket URL.
    const ticketArgs = vi.mocked(client.createSyncTicket).mock.calls[0];
    expect(ticketArgs?.[0]).toBe(NOTES_STREAM);
    expect(ticketArgs?.[1]).toBe(SEAT);
    expect(typeof ticketArgs?.[2]).toBe('number');

    // The WS URL carries the ticket and NOTHING sensitive.
    expect(wsUrl).toContain('ticket=');
    expect(wsUrl).not.toContain('seat_token');
    expect(wsUrl).not.toContain('access_token');
    expect(wsUrl).not.toContain(SEAT);
    expect(wsUrl).not.toContain(ACCESS);

    c.stop();
  });

  it('a fresh client catches up via pull (since=0) before going live', async () => {
    const relay = new FakeRelay();
    const keyB64 = await generateMatterKey();

    // Seed the matter with one client's edit.
    const seeder = new MatterSyncClient({
      matterHandle: MATTER,
      streamHandle: NOTES_STREAM,
      keyB64,
      keyEpoch: 1,
      seatToken: 'seat',
      accessToken: 'access',
      client: fakeClient(relay),
      socketFactory: () => {
        const s = new FakeSocket();
        relay.connect(s);
        return s;
      },
    });
    await seeder.start();
    seeder.doc.getMap('matter').set('client', 'Acme Corp');
    await until(() => relay.blobs.length > 0);
    seeder.stop();

    // A brand-new client starts AFTER the edit; catch-up must apply it.
    const late = new MatterSyncClient({
      matterHandle: MATTER,
      streamHandle: NOTES_STREAM,
      keyB64,
      keyEpoch: 1,
      seatToken: 'seat',
      accessToken: 'access',
      client: fakeClient(relay),
      socketFactory: () => {
        const s = new FakeSocket();
        relay.connect(s);
        return s;
      },
    });
    await late.start();
    await until(() => late.doc.getMap('matter').get('client') === 'Acme Corp');
    expect(late.doc.getMap('matter').get('client')).toBe('Acme Corp');
    late.stop();
  });

  it('reports a newer key_epoch from the relay (rotation signal)', async () => {
    const relay = new FakeRelay();
    relay.keyEpoch = 2; // server has rotated past the client's epoch 1
    const keyB64 = await generateMatterKey();
    const onKeyEpochAdvanced = vi.fn();

    const c = new MatterSyncClient({
      matterHandle: MATTER,
      streamHandle: NOTES_STREAM,
      keyB64,
      keyEpoch: 1,
      seatToken: 'seat',
      accessToken: 'access',
      client: fakeClient(relay),
      socketFactory: () => {
        const s = new FakeSocket();
        relay.connect(s);
        return s;
      },
      callbacks: { onKeyEpochAdvanced },
    });
    await c.start();
    await until(() => onKeyEpochAdvanced.mock.calls.length > 0);
    expect(onKeyEpochAdvanced).toHaveBeenCalledWith(2);
    c.stop();
  });

  it('never advances past an undecryptable peer frame, then re-pulls it after the key arrives', async () => {
    const oldKey = await generateMatterKey();
    const newKey = await generateMatterKey();
    const newCryptoKey = await importMatterKey(newKey);
    const makeUpdate = async (cursor: number, blob_id: string, field: string) => {
      const source = new Y.Doc();
      source.getMap('matter').set(field, `value-${field}`);
      return {
        cursor, blob_id, key_epoch: 2, author_seat: 'peer', created_at: 'now',
        ciphertext_b64: await encryptUpdateV2(newCryptoKey, Y.encodeStateAsUpdate(source), {
          keyEpoch: 2, matterHandle: MATTER, streamHandle: NOTES_STREAM,
        }),
      };
    };
    const first = await makeUpdate(1, `bh2_${'F'.repeat(43)}`, 'first');
    const second = await makeUpdate(2, `bh2_${'S'.repeat(43)}`, 'second');
    let relayUpdates: Array<typeof first> = [];
    const pullUpdates = vi.fn(async (_stream: StreamHandle, since: number): Promise<PullUpdatesResponse> => ({
      key_epoch: 2, since, cursor: relayUpdates.at(-1)?.cursor ?? since,
      latest_cursor: relayUpdates.at(-1)?.cursor ?? 0, has_more: false,
      updates: relayUpdates.filter((update) => update.cursor > since),
    }));
    const sockets: FakeSocket[] = [];
    const onKeyEpochAdvanced = vi.fn();
    const client = {
      pushUpdate: vi.fn(async () => ({ ok: true, cursor: 99, blob_id: 'local', key_epoch: 1, duplicate: false })),
      pullUpdates,
      createSyncTicket: vi.fn(async () => ({ ticket: 'cursor-gap-ticket', expires_in_ms: 30_000 })),
    } as unknown as import('@/platform/firm/FirmApiClient').FirmApiClient;
    const c = new MatterSyncClient({
      matterHandle: MATTER, streamHandle: NOTES_STREAM, keyB64: oldKey, keyEpoch: 1, seatToken: 'seat', client,
      callbacks: { onKeyEpochAdvanced },
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        queueMicrotask(() => socket.open());
        return socket;
      },
    });

    await c.start();
    await until(() => sockets.length === 1);
    relayUpdates = [first, second];
    // These arrive in wire order. Crypto is async; the client must preserve
    // that order and must not let the second frame jump cursor 1.
    sockets[0]!.deliver({ type: 'update', ...first });
    sockets[0]!.deliver({ type: 'update', ...second });
    await until(() => onKeyEpochAdvanced.mock.calls.length > 0);
    expect(c.getCursor()).toBe(0);
    expect(c.doc.getMap('matter').get('second')).toBeUndefined();

    // A real socket drop cannot turn the gap into an acknowledgement. The
    // replacement connection is opened before the new key causes its re-pull.
    sockets[0]!.onclose?.({});
    await (c as unknown as { reconnectNow(): Promise<void> }).reconnectNow();
    expect(sockets).toHaveLength(2);
    await c.rotateKey(newKey, 2);
    expect(pullUpdates).toHaveBeenLastCalledWith(NOTES_STREAM, 0, 'seat');
    expect(c.getCursor()).toBe(2);
    expect(c.doc.getMap('matter').get('first')).toBe('value-first');
    expect(c.doc.getMap('matter').get('second')).toBe('value-second');
    c.stop();
  });

  it('does not treat a local push acknowledgement as an applied-peer cursor', async () => {
    const keyB64 = await generateMatterKey();
    const pushUpdate = vi.fn(async () => ({ ok: true, cursor: 41, blob_id: 'local-only', key_epoch: 1, duplicate: false }));
    const client = {
      pushUpdate,
      pullUpdates: vi.fn(async (_stream: StreamHandle, since: number): Promise<PullUpdatesResponse> => ({ key_epoch: 1, since, cursor: since, latest_cursor: 0, has_more: false, updates: [] })),
      createSyncTicket: vi.fn(async () => ({ ticket: 'local-ack-ticket', expires_in_ms: 30_000 })),
    } as unknown as import('@/platform/firm/FirmApiClient').FirmApiClient;
    const c = new MatterSyncClient({
      matterHandle: MATTER, streamHandle: NOTES_STREAM, keyB64, keyEpoch: 1, seatToken: 'seat', client,
      socketFactory: () => { const socket = new FakeSocket(); queueMicrotask(() => socket.open()); return socket; },
    });
    await c.start();
    c.doc.getMap('matter').set('local', 'only');
    await until(() => pushUpdate.mock.calls.length === 1);
    expect(c.getCursor()).toBe(0);
    c.stop();
  });
});

// ---------------------------------------------------------------------------
// QA-46: reconnect-with-backoff + queued unsent updates after a socket drop
// ---------------------------------------------------------------------------
describe('MatterSyncClient reconnect + queued updates (QA-46)', () => {
  it('re-arms with a new socket after an unexpected close, while still started', async () => {
    vi.useFakeTimers();
    try {
      const relay = new FakeRelay();
      const keyB64 = await generateMatterKey();
      const sockets: FakeSocket[] = [];
      let socketsCreated = 0;

      const c = new MatterSyncClient({
        matterHandle: MATTER,
        streamHandle: NOTES_STREAM,
        keyB64,
        keyEpoch: 1,
        seatToken: 'seat',
        client: fakeClient(relay),
        socketFactory: () => {
          socketsCreated += 1;
          const s = new FakeSocket();
          sockets.push(s);
          relay.connect(s);
          return s;
        },
      });

      await c.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(c.getStatus()).toBe('live');
      expect(socketsCreated).toBe(1);

      // Simulate an unexpected drop (network blip) — NOT a stop() call.
      sockets[0]!.onclose?.({});
      expect(c.getStatus()).toBe('offline');

      // No reconnect should have happened yet — it's backed off.
      expect(socketsCreated).toBe(1);

      // Advance past the first backoff window; a new socket must be opened.
      await vi.advanceTimersByTimeAsync(1000);
      expect(socketsCreated).toBe(2);
      expect(c.getStatus()).toBe('live');

      c.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not keep reconnecting after stop() is called', async () => {
    vi.useFakeTimers();
    try {
      const relay = new FakeRelay();
      const keyB64 = await generateMatterKey();
      let socketsCreated = 0;

      const c = new MatterSyncClient({
        matterHandle: MATTER,
        streamHandle: NOTES_STREAM,
        keyB64,
        keyEpoch: 1,
        seatToken: 'seat',
        client: fakeClient(relay),
        socketFactory: () => {
          socketsCreated += 1;
          const s = new FakeSocket();
          relay.connect(s);
          return s;
        },
      });

      await c.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(socketsCreated).toBe(1);

      c.stop();
      // Advance well past any backoff window — no reconnect should fire.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(socketsCreated).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('queues an unsent local update when the push fails and flushes it once connectivity returns', async () => {
    vi.useFakeTimers();
    try {
      const relay = new FakeRelay();
      const keyB64 = await generateMatterKey();
      let failPush = false;
      const client = {
        pushUpdate: vi.fn(
          async (_matter: string, _stream: string, blobId: string, ct: string, _seat: string, epoch?: number) => {
            if (failPush) throw new Error('network down');
            return relay.push(blobId, ct, epoch ?? relay.keyEpoch);
          },
        ),
        pullUpdates: vi.fn(async (_m: string, since: number) => relay.pull(since)),
        createSyncTicket: vi.fn((...args: [string, string]) => {
          void args;
          return Promise.resolve({ ticket: `tkt_${Math.random().toString(36).slice(2)}`, expires_in_ms: 30_000 });
        }),
      } as unknown as import('@/platform/firm/FirmApiClient').FirmApiClient;

      const c = new MatterSyncClient({
        matterHandle: MATTER,
        streamHandle: NOTES_STREAM,
        keyB64,
        keyEpoch: 1,
        seatToken: 'seat',
        client,
        socketFactory: () => {
          const s = new FakeSocket();
          relay.connect(s);
          return s;
        },
      });

      await c.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(c.getStatus()).toBe('live');

      // Local edit made while the relay is unreachable.
      failPush = true;
      c.doc.getMap('m').set('x', 'queued-while-offline');
      // pushLocalUpdate awaits ensureKey()/encryptUpdateV2() (real WebCrypto
      // ops) before it ever reaches the network call, so give it a few
      // fake-timer ticks rather than asserting immediately.
      await waitForFake(() => c.getStatus() === 'offline', 1000, 1);
      expect(c.getStatus()).toBe('offline');
      expect(relay.blobs.length).toBe(0); // never made it out

      // Connectivity returns; the backoff-scheduled reconnect should flush
      // the queued update. Tick forward in small steps so the async
      // flush/reopen chain (real WebCrypto + relay round-trips) settles.
      failPush = false;
      await waitForFake(() => relay.blobs.length > 0, 1000, 50);
      expect(relay.blobs.length).toBe(1);
      expect(c.getStatus()).toBe('live');

      c.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  // codex-review finding (P1): a queued push that keeps failing across
  // MULTIPLE backoff cycles must keep re-arming its own retry — not just
  // the first one — even though the socket itself reconnects/stays fine.
  it('keeps retrying a persistently-failing push across multiple backoff cycles, not just the first', async () => {
    vi.useFakeTimers();
    try {
      const relay = new FakeRelay();
      const keyB64 = await generateMatterKey();
      let failPush = true;
      const client = {
        pushUpdate: vi.fn(
          async (_matter: string, _stream: string, blobId: string, ct: string, _seat: string, epoch?: number) => {
            if (failPush) throw new Error('network down');
            return relay.push(blobId, ct, epoch ?? relay.keyEpoch);
          },
        ),
        pullUpdates: vi.fn(async (_m: string, since: number) => relay.pull(since)),
        createSyncTicket: vi.fn((...args: [string, string]) => {
          void args;
          return Promise.resolve({ ticket: `tkt_${Math.random().toString(36).slice(2)}`, expires_in_ms: 30_000 });
        }),
      } as unknown as import('@/platform/firm/FirmApiClient').FirmApiClient;

      const c = new MatterSyncClient({
        matterHandle: MATTER,
        streamHandle: NOTES_STREAM,
        keyB64,
        keyEpoch: 1,
        seatToken: 'seat',
        client,
        socketFactory: () => {
          const s = new FakeSocket();
          relay.connect(s);
          return s;
        },
      });

      await c.start();
      await vi.advanceTimersByTimeAsync(0);

      // First local edit fails to push immediately (relay unreachable from
      // the start).
      c.doc.getMap('m').set('x', 'attempt-1');
      await waitForFake(() => c.getStatus() === 'offline', 1000, 1);
      expect(c.getStatus()).toBe('offline');

      // First backoff (~1s) fires — the retry ALSO fails (still down). Before
      // the fix, this second failure left nothing scheduled to try again.
      await advanceFake(30, 50); // ~1.5s of fake time
      expect(relay.blobs.length).toBe(0);

      // NOW connectivity returns. If the client re-armed its own retry after
      // the second failure, the next backoff cycle (~2s, exponential) will
      // flush the still-queued update without any further local edits.
      failPush = false;
      await waitForFake(() => relay.blobs.length > 0, 1000, 100);
      expect(relay.blobs.length).toBe(1);
      expect(c.getStatus()).toBe('live');

      c.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  // codex-review finding (P2): a reconnect triggered by something OTHER than
  // a real socket close (here: the push itself failing while the WebSocket
  // stays open) must NOT stand up a second, duplicate live socket.
  it('does not open a duplicate socket when only the push (not the socket) fails', async () => {
    vi.useFakeTimers();
    try {
      const relay = new FakeRelay();
      const keyB64 = await generateMatterKey();
      let failPush = false;
      let socketsCreated = 0;
      const client = {
        pushUpdate: vi.fn(
          async (_matter: string, _stream: string, blobId: string, ct: string, _seat: string, epoch?: number) => {
            if (failPush) throw new Error('network down');
            return relay.push(blobId, ct, epoch ?? relay.keyEpoch);
          },
        ),
        pullUpdates: vi.fn(async (_m: string, since: number) => relay.pull(since)),
        createSyncTicket: vi.fn((...args: [string, string]) => {
          void args;
          return Promise.resolve({ ticket: `tkt_${Math.random().toString(36).slice(2)}`, expires_in_ms: 30_000 });
        }),
      } as unknown as import('@/platform/firm/FirmApiClient').FirmApiClient;

      const c = new MatterSyncClient({
        matterHandle: MATTER,
        streamHandle: NOTES_STREAM,
        keyB64,
        keyEpoch: 1,
        seatToken: 'seat',
        client,
        socketFactory: () => {
          socketsCreated += 1;
          const s = new FakeSocket();
          relay.connect(s);
          return s;
        },
      });

      await c.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(socketsCreated).toBe(1);

      failPush = true;
      c.doc.getMap('m').set('x', 'push-only-failure');
      await waitForFake(() => c.getStatus() === 'offline', 1000, 1);

      failPush = false;
      await waitForFake(() => relay.blobs.length > 0, 1000, 50);
      expect(relay.blobs.length).toBe(1);
      // The WebSocket itself was never actually disconnected — the reconnect
      // machinery must not have opened a second one alongside it.
      expect(socketsCreated).toBe(1);
      expect(c.getStatus()).toBe('live');

      c.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
