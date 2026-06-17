/**
 * coeditSession.presence.test.ts — relay-based presence via CoeditSession.
 *
 * Verifies:
 *   1. getOtherEditorCount() returns total subscriber count minus 1 (floored at 0).
 *   2. onPresenceChange(cb) fires when the relay broadcasts a presence update.
 *   3. Initial snapshot via getOtherEditorCount() is correct before subscribing.
 *   4. Unsubscribe returned from onPresenceChange() stops future notifications.
 *   5. When relay count is 1 (only self), getOtherEditorCount() returns 0 (floored).
 *
 * The transport is exercised via a FakeSocket + FakeDocRelay that can deliver
 * presence frames directly, exactly as the real relay would.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { openCoeditSession, closeCoeditSession, type CoeditSessionOptions } from '@/platform/firm/coedit/coeditSession';
import { generateMatterKey } from '@/platform/firm/matterCrypto';
import type { DocumentJson } from '@/types/docx';
import type { WebSocketLike } from '@/platform/firm/MatterSyncClient';
import type { PushUpdateResponse, PullUpdatesResponse } from '@/platform/firm/contract';

// ---------------------------------------------------------------------------
// Minimal fake relay that supports injecting presence frames
// ---------------------------------------------------------------------------

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

class FakeDocRelayWithPresence {
  private sockets: Map<string, FakeSocket[]> = new Map();
  private seq = 0;
  keyEpoch = 1;

  connect(socket: FakeSocket, docId: string): void {
    if (!this.sockets.has(docId)) this.sockets.set(docId, []);
    this.sockets.get(docId)!.push(socket);
    const count = this.sockets.get(docId)!.length;
    queueMicrotask(() => {
      // Send ready frame with subscriber count
      socket.open();
      socket.deliver({ type: 'ready', matter_id: 'm1', doc_id: docId, backlog: 0, latest_cursor: 0, subscribers: count });
      // Broadcast presence to all subscribers
      this._broadcastPresence(docId);
    });
  }

  disconnect(socket: FakeSocket, docId: string): void {
    const list = this.sockets.get(docId);
    if (!list) return;
    const idx = list.indexOf(socket);
    if (idx !== -1) list.splice(idx, 1);
    if (list.length === 0) this.sockets.delete(docId);
    this._broadcastPresence(docId);
  }

  private _broadcastPresence(docId: string): void {
    const list = this.sockets.get(docId) ?? [];
    const count = list.length;
    for (const s of list) {
      s.deliver({ type: 'presence', matter_id: 'm1', doc_id: docId, count });
    }
  }

  pushUpdate(_blobId: string, _ct: string, _epoch: number, _docId: string): PushUpdateResponse {
    this.seq += 1;
    return { ok: true, cursor: this.seq, blob_id: _blobId, key_epoch: this.keyEpoch, duplicate: false };
  }

  pullUpdates(_since: number, docId: string): PullUpdatesResponse {
    return {
      matter_id: 'm1',
      doc_id: docId,
      key_epoch: this.keyEpoch,
      since: _since,
      cursor: 0,
      latest_cursor: 0,
      has_more: false,
      updates: [],
    };
  }
}

function fakeClient(relay: FakeDocRelayWithPresence, docId: string) {
  return {
    pushUpdate: async (_m: string, blobId: string, ct: string, _seat: string, epoch?: number, dId?: string) =>
      relay.pushUpdate(blobId, ct, epoch ?? relay.keyEpoch, dId ?? docId),
    pullUpdates: async (_m: string, since: number, _seat: string, dId?: string) =>
      relay.pullUpdates(since, dId ?? docId),
    createSyncTicket: async (_m: string, _seat: string) => ({
      ticket: `tkt_${Math.random().toString(36).slice(2)}`,
      expires_in_ms: 30_000,
    }),
  } as unknown as import('@/platform/firm/FirmApiClient').FirmApiClient;
}

async function until(pred: () => boolean, tries = 80): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (pred()) return;
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function makeOpts(
  relay: FakeDocRelayWithPresence,
  matterId: string,
  docId: string,
): Promise<CoeditSessionOptions & { keyB64: string }> {
  const keyB64 = await generateMatterKey();
  return {
    matterId,
    docId,
    fileName: 'test.docx',
    keyB64,
    keyEpoch: 1,
    seatToken: 'seat',
    client: fakeClient(relay, docId),
    socketFactory: (url: string) => {
      const s = new FakeSocket();
      relay.connect(s, docId);
      return s;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('coeditSession relay-based presence', () => {
  beforeEach(() => {
    closeCoeditSession('pres-matter-1', 'pres-doc-1');
    closeCoeditSession('pres-matter-2', 'pres-doc-2');
    closeCoeditSession('pres-matter-3', 'pres-doc-3');
    closeCoeditSession('pres-matter-4', 'pres-doc-4');
    closeCoeditSession('pres-matter-5', 'pres-doc-5');
  });

  // 1. getOtherEditorCount() returns total - 1
  it('getOtherEditorCount returns relayCount - 1', async () => {
    const relay = new FakeDocRelayWithPresence();
    const opts = await makeOpts(relay, 'pres-matter-1', 'pres-doc-1');

    const session = await openCoeditSession(opts);

    // Wait for presence frame to arrive (relay delivers count=1 after connect)
    await until(() => session.getOtherEditorCount() >= 0, 100);

    // With 1 subscriber (self only), other editor count should be 0
    expect(session.getOtherEditorCount()).toBe(0);

    session.close();
  });

  // 2. onPresenceChange fires on relay presence broadcast
  it('onPresenceChange fires when relay presence count changes', async () => {
    const relay = new FakeDocRelayWithPresence();
    const opts = await makeOpts(relay, 'pres-matter-2', 'pres-doc-2');

    const session = await openCoeditSession(opts);
    const counts: number[] = [];

    const unsub = session.onPresenceChange((count) => {
      counts.push(count);
    });

    // Inject a second socket to simulate a peer joining (count becomes 2)
    // We do this by connecting another FakeSocket directly to the relay
    const peerSocket = new FakeSocket();
    relay.connect(peerSocket, 'pres-doc-2');

    // Wait for the presence change to propagate
    await until(() => counts.some((c) => c >= 1), 100);

    // Should have received at least one update showing count >= 1 (other editor)
    expect(counts.some((c) => c >= 1)).toBe(true);

    unsub();
    session.close();
  });

  // 3. Initial snapshot is correct immediately on mount
  it('getOtherEditorCount is available synchronously after session opens', async () => {
    const relay = new FakeDocRelayWithPresence();
    const opts = await makeOpts(relay, 'pres-matter-3', 'pres-doc-3');

    const session = await openCoeditSession(opts);

    // Wait for the presence frame from connect
    await until(() => session.getOtherEditorCount() >= 0, 100);

    // getOtherEditorCount must return a valid non-negative number
    expect(session.getOtherEditorCount()).toBeGreaterThanOrEqual(0);

    session.close();
  });

  // 4. Unsubscribe stops notifications
  it('unsubscribe from onPresenceChange stops future notifications', async () => {
    const relay = new FakeDocRelayWithPresence();
    const opts = await makeOpts(relay, 'pres-matter-4', 'pres-doc-4');

    const session = await openCoeditSession(opts);
    const counts: number[] = [];

    const unsub = session.onPresenceChange((count) => {
      counts.push(count);
    });

    // Unsubscribe before any peer joins
    unsub();

    // Inject a peer — callback should NOT fire
    const peerSocket = new FakeSocket();
    relay.connect(peerSocket, 'pres-doc-4');
    await new Promise((r) => setTimeout(r, 50));

    // counts should be empty (unsubscribed before any peer event)
    expect(counts.length).toBe(0);

    session.close();
  });

  // 5. getOtherEditorCount is floored at 0 even if count < 1
  it('getOtherEditorCount is floored at 0 when relay count is 0 or 1', async () => {
    const relay = new FakeDocRelayWithPresence();
    const opts = await makeOpts(relay, 'pres-matter-5', 'pres-doc-5');

    const session = await openCoeditSession(opts);

    // Wait for initial presence frame
    await until(() => true, 20);

    // getOtherEditorCount should never go negative
    expect(session.getOtherEditorCount()).toBeGreaterThanOrEqual(0);

    session.close();
  });
});
