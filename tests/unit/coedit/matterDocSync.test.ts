/**
 * MatterDocSyncClient — Task 8 integration test.
 *
 * Mirrors the mock-relay pattern from tests/unit/firm/matterSync.test.ts.
 *
 * Two MatterDocSyncClient instances for the same (matter, docId), each wrapping
 * a Y.Doc built via documentJsonToYDoc. An editRunText on client A propagates
 * (encrypted) to client B and both yDocToDocumentJson converge. An update for a
 * DIFFERENT docId is NOT applied.
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { MatterDocSyncClient } from '@/platform/firm/coedit/MatterDocSyncClient';
import { documentJsonToYDoc, yDocToDocumentJson, editRunText } from '@/platform/firm/coedit/docCrdt';
import { generateMatterKey, importMatterKey } from '@/platform/firm/matterCrypto';
import type { PushUpdateResponse, PullUpdatesResponse } from '@/platform/firm/contract';
import type { WebSocketLike } from '@/platform/firm/MatterSyncClient';
import type { DocumentJson, DocxParagraph } from '@/types/docx';

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

// ---------------------------------------------------------------------------
// Fake relay (doc_id-aware, mirrors FakeDocRelay from matterSync.test.ts)
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
    const allForDoc = this.blobs.filter((b) => b.doc_id === docId);
    const latest = allForDoc.length ? allForDoc[allForDoc.length - 1]!.cursor : 0;
    queueMicrotask(() => {
      socket.open();
      socket.deliver({ type: 'ready', matter_id: 'm1', doc_id: docId, backlog: allForDoc.length, latest_cursor: latest });
    });
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

/** A FirmApiClient stub exposing only what MatterSyncClient calls. */
function fakeClient(relay: FakeDocRelay, docId: string) {
  return {
    pushUpdate: async (_m: string, blobId: string, ct: string, _seat: string, epoch?: number, dId?: string) =>
      relay.push(blobId, ct, epoch ?? relay.keyEpoch, dId ?? docId),
    pullUpdates: async (_m: string, since: number, _seat: string, dId?: string) =>
      relay.pull(since, dId ?? docId),
    createSyncTicket: async (_m: string, _seat: string) => ({
      ticket: `tkt_${Math.random().toString(36).slice(2)}`,
      expires_in_ms: 30_000,
    }),
  } as unknown as import('@/platform/firm/FirmApiClient').FirmApiClient;
}

async function until(pred: () => boolean, tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (pred()) return;
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * Seed a Y.Doc from a DocumentJson AFTER the sync client has started.
 *
 * Production: coeditSession.ts calls documentJsonToYDoc to build a fresh doc,
 * then seeds the relay by executing the transact on THAT doc. This helper
 * simulates that: it builds the body structure inside ONE transact executed
 * on a doc that already has its update listener wired (i.e. after start()).
 * This ensures the full document structure lands in the relay so peers can
 * catch up.
 */
import * as Y2 from 'yjs';

function seedDocAfterStart(doc: Y.Doc, base: DocumentJson): { blockId: string; runId: string } {
  let blockId = '';
  let runId = '';
  doc.transact(() => {
    const metaMap = doc.getMap<unknown>('meta');
    metaMap.set('formatVersion', base.formatVersion);

    const body = doc.getArray<Y.Map<unknown>>('body');
    for (const block of base.body) {
      const bm = new Y2.Map<unknown>();
      const bid = crypto.randomUUID();
      bm.set('id', bid);
      if (block.kind === 'raw') {
        bm.set('type', 'raw');
        bm.set('rawXml', (block as { kind: 'raw'; xml: string }).xml);
      } else {
        bm.set('type', 'paragraph');
        bm.set('propsXml', (block as DocxParagraph).propertiesXml ?? null);
        const runs = new Y2.Array<Y.Map<unknown>>();
        bm.set('runs', runs);
        blockId = bid;
        for (const inline of (block as DocxParagraph).inlines) {
          if (inline.kind === 'run') {
            const rm = new Y2.Map<unknown>();
            const rid = crypto.randomUUID();
            rm.set('id', rid);
            rm.set('kind', 'text');
            const t = new Y2.Text();
            rm.set('text', t);
            t.insert(0, inline.text);
            rm.set('propsXml', inline.propertiesXml ?? null);
            rm.set('preserveSpace', inline.preserveSpace ?? false);
            runs.push([rm]);
            runId = rid;
          }
        }
      }
      body.push([bm]);
    }
  });
  return { blockId, runId };
}

describe('MatterDocSyncClient', () => {
  it('two clients on the same (matter, docId) converge after an editRunText on client A', async () => {
    const relay = new FakeDocRelay();
    const keyB64 = await generateMatterKey();
    const docId = 'doc-001';

    // Client A: start with an empty Y.Doc, then seed the doc structure AFTER
    // start() so the update handler is wired and the full state lands in the relay.
    const docA = new Y.Doc();
    const clientA = new MatterDocSyncClient({
      matterId: 'm1',
      docId,
      doc: docA,
      keyB64,
      keyEpoch: 1,
      seatToken: 'seat',
      client: fakeClient(relay, docId),
      socketFactory: () => {
        const s = new FakeSocket();
        relay.connect(s, docId);
        return s;
      },
    });
    await clientA.start();

    // Seed the doc structure via a transaction post-start (this is what
    // coeditSession.ts does on first open of a document).
    const { blockId, runId } = seedDocAfterStart(docA, BASE_DOC);

    // Wait for the seed blob to land in the relay
    await until(() => relay.blobs.some((b) => b.doc_id === docId));

    // Edit on client A — this delta also lands in the relay
    editRunText(docA, blockId, runId, 'Hello world', 'Hello converged', 'attorney-a');
    await until(() => relay.blobs.filter((b) => b.doc_id === docId).length >= 2);

    // Client B starts with an EMPTY Y.Doc and catches up from the relay
    const docB = new Y.Doc();
    const clientB = new MatterDocSyncClient({
      matterId: 'm1',
      docId,
      doc: docB,
      keyB64,
      keyEpoch: 1,
      seatToken: 'seat',
      client: fakeClient(relay, docId),
      socketFactory: () => {
        const s = new FakeSocket();
        relay.connect(s, docId);
        return s;
      },
    });
    await clientB.start();

    // Wait for docB to converge to A's state (body + edited text)
    await until(() => {
      const json = yDocToDocumentJson(docB);
      const para = json.body[0] as DocxParagraph | undefined;
      if (!para || para.inlines.length === 0) return false;
      return para.inlines[0]?.kind === 'run' &&
        (para.inlines[0] as { kind: 'run'; text: string }).text === 'Hello converged';
    });

    const jsonA = yDocToDocumentJson(docA);
    const jsonB = yDocToDocumentJson(docB);

    const paraA = jsonA.body[0] as DocxParagraph;
    const paraB = jsonB.body[0] as DocxParagraph;

    expect((paraA.inlines[0] as { kind: 'run'; text: string }).text).toBe('Hello converged');
    expect((paraB.inlines[0] as { kind: 'run'; text: string }).text).toBe('Hello converged');

    // The relay only ever held ciphertext (not the plaintext sentinel)
    expect(relay.blobs.length).toBeGreaterThan(0);
    for (const blob of relay.blobs) {
      expect(blob.ciphertext_b64).not.toContain('Hello converged');
    }

    // Both doc states are byte-identical (full CRDT convergence)
    expect(Y.encodeStateAsUpdate(docA)).toEqual(Y.encodeStateAsUpdate(docB));

    clientA.stop();
    clientB.stop();
  });

  it('an update for a DIFFERENT docId is NOT applied to a client on another docId', async () => {
    const relay = new FakeDocRelay();
    const keyB64 = await generateMatterKey();

    const docAlpha = documentJsonToYDoc(BASE_DOC);
    const docBeta = documentJsonToYDoc(BASE_DOC);

    const clientAlpha = new MatterDocSyncClient({
      matterId: 'm1',
      docId: 'doc-alpha',
      doc: docAlpha,
      keyB64,
      keyEpoch: 1,
      seatToken: 'seat',
      client: fakeClient(relay, 'doc-alpha'),
      socketFactory: () => {
        const s = new FakeSocket();
        relay.connect(s, 'doc-alpha');
        return s;
      },
    });

    const clientBeta = new MatterDocSyncClient({
      matterId: 'm1',
      docId: 'doc-beta',
      doc: docBeta,
      keyB64,
      keyEpoch: 1,
      seatToken: 'seat',
      client: fakeClient(relay, 'doc-beta'),
      socketFactory: () => {
        const s = new FakeSocket();
        relay.connect(s, 'doc-beta');
        return s;
      },
    });

    await clientAlpha.start();
    await clientBeta.start();

    // Alpha writes a distinctive structural edit
    const bodyAlpha = docAlpha.getArray<Y.Map<unknown>>('body');
    const blockAlpha = bodyAlpha.get(0);
    const blockIdAlpha = blockAlpha.get('id') as string;
    const runsAlpha = blockAlpha.get('runs') as Y.Array<Y.Map<unknown>>;
    const runAlpha = runsAlpha.get(0);
    const runIdAlpha = runAlpha.get('id') as string;
    editRunText(docAlpha, blockIdAlpha, runIdAlpha, 'Hello world', 'ALPHA ONLY', 'attorney-a');

    // Wait for alpha's update to reach the relay
    await until(() => relay.blobs.some((b) => b.doc_id === 'doc-alpha'));

    // Give time for any spurious delivery to docBeta
    await new Promise((r) => setTimeout(r, 30));

    // Beta's doc must NOT contain alpha's edit
    const jsonBeta = yDocToDocumentJson(docBeta);
    const paraBeta = jsonBeta.body[0] as DocxParagraph;
    const betaText = (paraBeta.inlines[0] as { kind: string; text?: string }).text ?? '';
    expect(betaText).not.toBe('ALPHA ONLY');

    // Alpha's blobs stayed in the doc-alpha stream
    const alphaBlobs = relay.blobs.filter((b) => b.doc_id === 'doc-alpha');
    const betaBlobs = relay.blobs.filter((b) => b.doc_id === 'doc-beta');
    expect(alphaBlobs.length).toBeGreaterThan(0);
    expect(betaBlobs.length).toBe(0);

    clientAlpha.stop();
    clientBeta.stop();
  });

  it('client B catches up edits that happened before it joined', async () => {
    const relay = new FakeDocRelay();
    const keyB64 = await generateMatterKey();
    const docId = 'doc-catchup';

    // Client A: start with empty Y.Doc, seed via post-start transact, edit, stop
    const docA = new Y.Doc();
    const clientA = new MatterDocSyncClient({
      matterId: 'm1',
      docId,
      doc: docA,
      keyB64,
      keyEpoch: 1,
      seatToken: 'seat',
      client: fakeClient(relay, docId),
      socketFactory: () => {
        const s = new FakeSocket();
        relay.connect(s, docId);
        return s;
      },
    });
    await clientA.start();

    const { blockId: blockIdA, runId: runIdA } = seedDocAfterStart(docA, BASE_DOC);
    await until(() => relay.blobs.some((b) => b.doc_id === docId));

    editRunText(docA, blockIdA, runIdA, 'Hello world', 'Pre-joined edit', 'attorney-a');
    await until(() => relay.blobs.filter((b) => b.doc_id === docId).length >= 2);
    clientA.stop();

    // Client B joins after the edit with an empty Y.Doc (must catch up via pull)
    const docB = new Y.Doc();
    const clientB = new MatterDocSyncClient({
      matterId: 'm1',
      docId,
      doc: docB,
      keyB64,
      keyEpoch: 1,
      seatToken: 'seat',
      client: fakeClient(relay, docId),
      socketFactory: () => {
        const s = new FakeSocket();
        relay.connect(s, docId);
        return s;
      },
    });
    await clientB.start();

    await until(() => {
      const json = yDocToDocumentJson(docB);
      const para = json.body[0] as DocxParagraph | undefined;
      if (!para || para.inlines.length === 0) return false;
      return (para.inlines[0] as { kind: string; text?: string }).text === 'Pre-joined edit';
    });

    const jsonB = yDocToDocumentJson(docB);
    const paraB = jsonB.body[0] as DocxParagraph;
    expect((paraB.inlines[0] as { kind: string; text?: string }).text).toBe('Pre-joined edit');

    clientB.stop();
  });
});
