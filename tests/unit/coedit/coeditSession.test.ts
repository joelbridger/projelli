/**
 * coeditSession — Task 9 lifecycle singleton tests.
 *
 * Tests cover:
 *   1. JOIN: relay has state → openCoeditSession does NOT seed initialJson over it
 *   2. SEED: relay is empty → openCoeditSession seeds from initialJson
 *   3. SINGLETON: concurrent opens for same (matter,doc) resolve to same session
 *   4. onChange: fires on a local edit; getDocumentJson() reflects it
 *   5. close(): tears down — a subsequent open creates a fresh session
 *
 * The MatterDocSyncClient is mocked via a fake relay + socketFactory pattern
 * mirroring matterDocSync.test.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { openCoeditSession, closeCoeditSession, type CoeditSessionOptions } from '@/platform/firm/coedit/coeditSession';
import { documentJsonToYDoc, editRunText } from '@/platform/firm/coedit/docCrdt';
import { generateMatterKey } from '@/platform/firm/matterCrypto';
import { createOpaqueBlobId } from '@/platform/firm/opaqueBlobId';
import type { DocumentJson, DocxParagraph } from '@/platform/types/docx';
import type { WebSocketLike } from '@/platform/firm/MatterSyncClient';
import type { PushUpdateResponse, PullUpdatesResponse } from '@/platform/firm/contract';
import type { MatterHandle, StreamHandle } from '@/platform/firm/contract';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_DOC: DocumentJson = {
  formatVersion: 1,
  body: [
    {
      kind: 'paragraph',
      inlines: [
        { kind: 'run', text: 'Hello world', preserveSpace: false },
      ],
    } as DocxParagraph,
  ],
  comments: {},
};

const matterHandleFor = (matterId: string): MatterHandle =>
  `mh2_${matterId.padEnd(43, '_').slice(0, 43)}` as MatterHandle;
const streamHandleFor = (docId: string): StreamHandle =>
  `sh2_${docId.padEnd(43, '_').slice(0, 43)}` as StreamHandle;

// ---------------------------------------------------------------------------
// Fake relay (doc_id-aware, mirrors FakeDocRelay from matterDocSync.test.ts)
// ---------------------------------------------------------------------------

interface StoredBlob {
  cursor: number;
  blob_id: string;
  key_epoch: number;
  ciphertext_b64: string;
  doc_id: string;
}

class FakeDocRelay {
  blobs: StoredBlob[] = [];
  private seq = 0;
  private sockets: Map<string, FakeSocket[]> = new Map();
  keyEpoch = 1;

  push(blobId: string, ct: string, epoch: number, docId: string): PushUpdateResponse {
    const existing = this.blobs.find((b) => b.blob_id === blobId && b.doc_id === docId);
    if (existing) {
      return { ok: true, cursor: existing.cursor, blob_id: blobId, key_epoch: this.keyEpoch, duplicate: true };
    }
    this.seq += 1;
    const stored: StoredBlob = { cursor: this.seq, blob_id: blobId, key_epoch: epoch, ciphertext_b64: ct, doc_id: docId };
    this.blobs.push(stored);
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
    const allForDoc = this.blobs.filter((b) => b.doc_id === docId);
    const latest = allForDoc.length ? allForDoc[allForDoc.length - 1]!.cursor : 0;
    return {
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
    const allForDoc = this.blobs.filter((b) => b.doc_id === docId);
    const latest = allForDoc.length ? allForDoc[allForDoc.length - 1]!.cursor : 0;
    queueMicrotask(() => {
      socket.open();
      socket.deliver({ type: 'ready', matter_id: 'm1', doc_id: docId, backlog: allForDoc.length, latest_cursor: latest });
    });
  }

  /** Pre-load relay with state from a Y.Doc (simulates prior sync). */
  async preload(keyB64: string, matterHandle: MatterHandle, streamHandle: StreamHandle, docId: string, doc: Y.Doc): Promise<void> {
    const { encryptUpdateV2, importMatterKey } = await import('@/platform/firm/matterCrypto');
    const cryptoKey = await importMatterKey(keyB64);
    const update = Y.encodeStateAsUpdate(doc);
    const ciphertext_b64 = await encryptUpdateV2(cryptoKey, update, { keyEpoch: 1, matterHandle, streamHandle });
    const blob_id = createOpaqueBlobId();
    this.push(blob_id, ciphertext_b64, 1, docId);
  }
}

class FakeSocket implements WebSocketLike {
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  send(): void { /* relay ignores inbound frames */ }
  close(): void { this.onclose?.({}); }
  open(): void { this.onopen?.({}); }
  deliver(frame: unknown): void { this.onmessage?.({ data: JSON.stringify(frame) }); }
}

function fakeClient(relay: FakeDocRelay, docId: string) {
  return {
    pushUpdate: async (_m: string, blobId: string, ct: string, _seat: string, epoch?: number, dId?: string) =>
      relay.push(blobId, ct, epoch ?? relay.keyEpoch, dId ?? docId),
    pullUpdates: async (_m: string, since: number, _seat: string, dId?: string) =>
      relay.pull(since, dId ?? docId),
    createSyncTicket: (...args: [string, string]) => {
      void args;
      return Promise.resolve({ ticket: `tkt_${Math.random().toString(36).slice(2)}`, expires_in_ms: 30_000 });
    },
  } as unknown as import('@/platform/firm/FirmApiClient').FirmApiClient;
}

async function until(pred: () => boolean, tries = 80): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (pred()) return;
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));
  }
}

// ---------------------------------------------------------------------------
// Build opts helper
// ---------------------------------------------------------------------------

async function makeOpts(relay: FakeDocRelay, matterId: string, docId: string, initialJson?: DocumentJson): Promise<CoeditSessionOptions & { keyB64: string }> {
  const keyB64 = await generateMatterKey();
  return {
    matterHandle: matterHandleFor(matterId),
    streamHandle: streamHandleFor(docId),
    docId,
    fileName: 'test.docx',
    ...(initialJson !== undefined ? { initialJson } : {}),
    keyB64,
    keyEpoch: 1,
    seatToken: 'seat',
    client: fakeClient(relay, docId),
    socketFactory: () => {
      const s = new FakeSocket();
      relay.connect(s, docId);
      return s;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('coeditSession', () => {
  // Ensure each test starts with a clean singleton cache
  beforeEach(async () => {
    // Reset module-level caches by closing any sessions that may be lingering.
    // The closeCoeditSession helper clears the cache.
    closeCoeditSession('matter-join', 'doc-join');
    closeCoeditSession('matter-seed', 'doc-seed');
    closeCoeditSession('matter-singleton', 'doc-singleton');
    closeCoeditSession('matter-change', 'doc-change');
    closeCoeditSession('matter-close', 'doc-close');
  });

  // -------------------------------------------------------------------------
  // 1. JOIN: relay has state → initialJson NOT seeded over it
  // -------------------------------------------------------------------------
  it('JOIN: relay already has doc state — initialJson does not override it', async () => {
    const relay = new FakeDocRelay();
    const docId = 'doc-join';
    const matterId = 'matter-join';
    const opts = await makeOpts(relay, matterId, docId, BASE_DOC);

    // Pre-seed relay with a different document (body with "Relay content")
    const relayDoc = documentJsonToYDoc({
      formatVersion: 1,
      body: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'Relay content' }] } as DocxParagraph],
      comments: {},
    });
    await relay.preload(opts.keyB64, opts.matterHandle, opts.streamHandle, docId, relayDoc);

    // Open session — relay already has state, initialJson (BASE_DOC = "Hello world") must NOT override it
    const session = await openCoeditSession(opts);

    const json = session.getDocumentJson();
    const para = json.body[0] as DocxParagraph | undefined;

    // The relay's "Relay content" must be present, not initialJson's "Hello world"
    expect(para).toBeDefined();
    if (para) {
      expect((para.inlines[0] as { kind: string; text?: string }).text).toBe('Relay content');
    }

    session.close();
  });

  // -------------------------------------------------------------------------
  // 2. SEED: relay is empty → seeds from initialJson
  // -------------------------------------------------------------------------
  it('SEED: relay is empty — seeds from initialJson and getDocumentJson returns it', async () => {
    const relay = new FakeDocRelay();
    const docId = 'doc-seed';
    const matterId = 'matter-seed';
    const opts = await makeOpts(relay, matterId, docId, BASE_DOC);

    const session = await openCoeditSession(opts);

    const json = session.getDocumentJson();
    expect(json.body.length).toBe(1);
    const para = json.body[0] as DocxParagraph;
    expect((para.inlines[0] as { kind: string; text?: string }).text).toBe('Hello world');

    session.close();
  });

  // -------------------------------------------------------------------------
  // 3. SINGLETON: concurrent opens for same (matter,doc) share one session
  // -------------------------------------------------------------------------
  it('SINGLETON: concurrent opens for same (matter,doc) resolve to the SAME session', async () => {
    const relay = new FakeDocRelay();
    const docId = 'doc-singleton';
    const matterId = 'matter-singleton';
    const opts = await makeOpts(relay, matterId, docId, BASE_DOC);

    // Fire two concurrent opens — pendingCache must deduplicate
    const [s1, s2] = await Promise.all([
      openCoeditSession(opts),
      openCoeditSession(opts),
    ]);

    expect(s1).toBe(s2);

    s1.close();
  });

  // -------------------------------------------------------------------------
  // 4. onChange fires on local edit; getDocumentJson reflects it
  // -------------------------------------------------------------------------
  it('onChange fires on a local edit and getDocumentJson reflects the change', async () => {
    const relay = new FakeDocRelay();
    const docId = 'doc-change';
    const matterId = 'matter-change';
    const opts = await makeOpts(relay, matterId, docId, BASE_DOC);

    const session = await openCoeditSession(opts);

    let changeCount = 0;
    const unsub = session.onChange(() => { changeCount++; });

    // Perform a local edit via the session's Y.Doc
    const body = session.doc.getArray<Y.Map<unknown>>('body');
    const block = body.get(0);
    const blockId = block.get('id') as string;
    const runs = block.get('runs') as Y.Array<Y.Map<unknown>>;
    const run = runs.get(0);
    const runId = run.get('id') as string;

    editRunText(session.doc, blockId, runId, 'Hello world', 'Edited text', 'attorney-a');

    await until(() => changeCount > 0);

    expect(changeCount).toBeGreaterThan(0);
    const json = session.getDocumentJson();
    const para = json.body[0] as DocxParagraph;
    expect((para.inlines[0] as { kind: string; text?: string }).text).toBe('Edited text');

    unsub();
    session.close();
  });

  // -------------------------------------------------------------------------
  // 5. close() tears down — a subsequent open creates a fresh session
  // -------------------------------------------------------------------------
  it('close() tears down so a subsequent open creates a fresh session', async () => {
    const relay = new FakeDocRelay();
    const docId = 'doc-close';
    const matterId = 'matter-close';
    const opts = await makeOpts(relay, matterId, docId, BASE_DOC);

    const s1 = await openCoeditSession(opts);
    s1.close();

    // After close, the caches are cleared; a new open MUST return a different session object
    const s2 = await openCoeditSession(opts);

    expect(s2).not.toBe(s1);

    s2.close();
  });

  // -------------------------------------------------------------------------
  // 6. SEED: no initialJson provided and relay is empty — body stays empty
  // -------------------------------------------------------------------------
  it('SEED: no initialJson provided and relay is empty — body stays empty', async () => {
    const relay = new FakeDocRelay();
    const docId = 'doc-no-seed';
    const matterId = 'matter-no-seed';

    closeCoeditSession(matterId, docId);

    const opts = await makeOpts(relay, matterId, docId, undefined);

    const session = await openCoeditSession(opts);

    const json = session.getDocumentJson();
    // No seed and no relay state — body should be empty
    expect(json.body.length).toBe(0);

    session.close();
  });
});
