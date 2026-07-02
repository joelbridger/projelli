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
import { generateMatterKey } from '@/platform/firm/matterCrypto';
import type { PushUpdateResponse, PullUpdatesResponse } from '@/platform/firm/contract';

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
        matter_id: 'm1',
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
        doc_id: '_notes',
        key_epoch: b.key_epoch,
        author_seat: 'seat-x',
        created_at: new Date().toISOString(),
        ciphertext_b64: b.ciphertext_b64,
      }));
    const latest = this.blobs.length ? this.blobs[this.blobs.length - 1]!.cursor : 0;
    return {
      matter_id: 'm1',
      doc_id: '_notes',
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
      socket.deliver({ type: 'ready', matter_id: 'm1', backlog: this.blobs.length, latest_cursor: this.seq });
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
      async (_m: string, blobId: string, ct: string, _seat: string, epoch?: number) =>
        relay.push(blobId, ct, epoch ?? relay.keyEpoch),
    ),
    pullUpdates: vi.fn(async (_m: string, since: number) => relay.pull(since)),
    // Mint a fake single-use ticket — what MatterSyncClient fetches before it
    // opens the WS. The seat token is passed via the (mocked) HTTP call, not the
    // URL; the test asserts the WS URL carries only the ticket.
    createSyncTicket: vi.fn(async (_m: string, _seat: string) => ({
      ticket: `tkt_${Math.random().toString(36).slice(2)}`,
      expires_in_ms: 30_000,
    })),
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

// ---------------------------------------------------------------------------
// Task 7: doc_id partitioning test (MUST fail before the implementation)
// ---------------------------------------------------------------------------

interface StoredBlobWithDoc extends StoredBlob {
  doc_id: string;
}

/**
 * A doc_id-aware relay: stores blobs keyed by (blob_id, doc_id), fans out ONLY
 * to sockets subscribed to the matching doc_id, and returns only matching blobs
 * on pull.
 */
class FakeDocRelay {
  blobs: StoredBlobWithDoc[] = [];
  private seq = 0;
  /** doc_id -> list of sockets subscribed to that doc stream */
  private sockets: Map<string, FakeSocket[]> = new Map();
  keyEpoch = 1;

  push(blobId: string, ciphertextB64: string, keyEpoch: number, docId: string): PushUpdateResponse {
    const existing = this.blobs.find((b) => b.blob_id === blobId && b.doc_id === docId);
    if (existing) {
      return { ok: true, cursor: existing.cursor, blob_id: blobId, key_epoch: this.keyEpoch, duplicate: true };
    }
    this.seq += 1;
    const stored: StoredBlobWithDoc = {
      cursor: this.seq,
      blob_id: blobId,
      key_epoch: keyEpoch,
      ciphertext_b64: ciphertextB64,
      doc_id: docId,
    };
    this.blobs.push(stored);
    // Fan out only to sockets subscribed to this doc_id.
    const docSockets = this.sockets.get(docId) ?? [];
    for (const s of docSockets) {
      s.deliver({
        type: 'update',
        matter_id: 'm1',
        doc_id: docId,
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

  pull(since: number, docId: string): PullUpdatesResponse {
    const updates = this.blobs
      .filter((b) => b.cursor > since && b.doc_id === docId)
      .map((b) => ({
        cursor: b.cursor,
        blob_id: b.blob_id,
        doc_id: b.doc_id,
        key_epoch: b.key_epoch,
        author_seat: 'seat-x',
        created_at: new Date().toISOString(),
        ciphertext_b64: b.ciphertext_b64,
      }));
    const allBlobs = this.blobs.filter((b) => b.doc_id === docId);
    const latest = allBlobs.length ? allBlobs[allBlobs.length - 1]!.cursor : 0;
    return {
      matter_id: 'm1',
      doc_id: docId,
      key_epoch: this.keyEpoch,
      since,
      cursor: updates.length ? updates[updates.length - 1]!.cursor : since,
      latest_cursor: latest,
      has_more: false,
      updates,
    };
  }

  connect(socket: FakeSocket, docId: string): void {
    if (!this.sockets.has(docId)) this.sockets.set(docId, []);
    this.sockets.get(docId)!.push(socket);
    const allBlobs = this.blobs.filter((b) => b.doc_id === docId);
    const latest = allBlobs.length ? allBlobs[allBlobs.length - 1]!.cursor : 0;
    queueMicrotask(() => {
      socket.open();
      socket.deliver({ type: 'ready', matter_id: 'm1', doc_id: docId, backlog: allBlobs.length, latest_cursor: latest });
    });
  }
}

function fakeDocClient(relay: FakeDocRelay, docId: string) {
  return {
    pushUpdate: vi.fn(
      async (_m: string, blobId: string, ct: string, _seat: string, epoch?: number, dId?: string) =>
        relay.push(blobId, ct, epoch ?? relay.keyEpoch, dId ?? docId),
    ),
    pullUpdates: vi.fn(async (_m: string, since: number, _seat: string, dId?: string) =>
      relay.pull(since, dId ?? docId),
    ),
    createSyncTicket: vi.fn(async (_m: string, _seat: string) => ({
      ticket: `tkt_${Math.random().toString(36).slice(2)}`,
      expires_in_ms: 30_000,
    })),
  } as unknown as import('@/platform/firm/FirmApiClient').FirmApiClient;
}

describe('MatterSyncClient doc_id partitioning', () => {
  it('two clients on the same matter but different docIds do NOT receive each other\'s updates', async () => {
    const relay = new FakeDocRelay();
    const keyB64 = await generateMatterKey();

    const mkDocClient = (docId: string) =>
      new MatterSyncClient({
        matterId: 'm1',
        keyB64,
        keyEpoch: 1,
        seatToken: 'seat',
        accessToken: 'access',
        docId,
        client: fakeDocClient(relay, docId),
        socketFactory: () => {
          const s = new FakeSocket();
          relay.connect(s, docId);
          return s;
        },
      });

    const notesClient = mkDocClient('_notes');
    const docAClient = mkDocClient('doc-alpha');

    await notesClient.start();
    await docAClient.start();

    // notesClient writes a note — should NOT appear in docAClient's doc.
    notesClient.doc.getMap('data').set('notes_key', 'notes_value');

    // docAClient writes — should NOT appear in notesClient's doc.
    docAClient.doc.getMap('data').set('doc_key', 'doc_value');

    // Wait for both writes to reach the relay (the push is async).
    await until(() => relay.blobs.some((b) => b.doc_id === '_notes'));
    await until(() => relay.blobs.some((b) => b.doc_id === 'doc-alpha'));

    // Cross-contamination must NOT occur.
    expect(notesClient.doc.getMap('data').get('doc_key')).toBeUndefined();
    expect(docAClient.doc.getMap('data').get('notes_key')).toBeUndefined();

    // Relay stored blobs in both streams — the doc_id partition holds.
    const notesBlobs = relay.blobs.filter((b) => b.doc_id === '_notes');
    const docABlobs = relay.blobs.filter((b) => b.doc_id === 'doc-alpha');
    expect(notesBlobs.length).toBeGreaterThan(0);
    expect(docABlobs.length).toBeGreaterThan(0);

    notesClient.stop();
    docAClient.stop();
  });

  it('a MatterSyncClient without docId defaults to _notes and behaves as before', async () => {
    const relay = new FakeDocRelay();
    const keyB64 = await generateMatterKey();

    // No docId in options — must default to '_notes'.
    const a = new MatterSyncClient({
      matterId: 'm1',
      keyB64,
      keyEpoch: 1,
      seatToken: 'seat',
      accessToken: 'access',
      client: fakeDocClient(relay, '_notes'),
      socketFactory: () => {
        const s = new FakeSocket();
        relay.connect(s, '_notes');
        return s;
      },
    });
    const b = new MatterSyncClient({
      matterId: 'm1',
      keyB64,
      keyEpoch: 1,
      seatToken: 'seat',
      accessToken: 'access',
      client: fakeDocClient(relay, '_notes'),
      socketFactory: () => {
        const s = new FakeSocket();
        relay.connect(s, '_notes');
        return s;
      },
    });

    await a.start();
    await b.start();

    a.doc.getMap('m').set('x', 'hello');
    await until(() => b.doc.getMap('m').get('x') === 'hello');
    expect(b.doc.getMap('m').get('x')).toBe('hello');

    // All blobs went into _notes stream.
    expect(relay.blobs.every((blob) => blob.doc_id === '_notes')).toBe(true);

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
        matterId: 'm1',
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
      matterId: 'm1',
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
    expect(client.createSyncTicket).toHaveBeenCalledWith('m1', SEAT);

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
      matterId: 'm1',
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
      matterId: 'm1',
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
      matterId: 'm1',
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
});
