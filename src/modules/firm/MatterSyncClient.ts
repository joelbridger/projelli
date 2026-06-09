/**
 * MatterSyncClient — the E2EE collaboration client for one shared matter.
 *
 * Drives a single Yjs document representing a shared matter's collaborative
 * state. The relay (backend) is a DUMB PIPE that only ever sees opaque
 * ciphertext; all encryption/decryption happens here with the per-matter key.
 *
 * Lifecycle (`start()`):
 *   1. Catch up: `GET /matter/:id/updates?since=<cursor>` (paged), decrypt each
 *      blob, apply to the Yjs doc, advance the cursor.
 *   2. Live: open `WS /matter/:id/sync`; the relay sends a `ready` frame then
 *      backlog + live `update` frames. Decrypt + apply each; advance the cursor.
 *   3. Send: on a local Yjs update, encrypt it under the matter key + current
 *      `key_epoch` and `POST /matter/:id/updates`. The relay never sees plaintext.
 *
 * Convergence: two clients sharing the same matter key apply each other's
 * (decrypted) Yjs updates and the CRDT guarantees they converge regardless of
 * order. Self-echo (the relay fans your own push back) is harmless — applying a
 * Yjs update you already have is a no-op.
 *
 * key_epoch: each push is tagged with the epoch it was sealed under (also bound
 * as AES-GCM AAD). If the relay reports a NEWER epoch (a member was removed or
 * a wall was set), we surface it via `onKeyEpochAdvanced` so the host can
 * re-provision/rotate the local key, then resume. Blobs we cannot decrypt
 * (sealed under an epoch we don't yet hold a key for) are skipped, never thrown.
 */

import * as Y from 'yjs';
import type { FirmApiClient } from './FirmApiClient';
import { encryptUpdate, decryptUpdate, importMatterKey } from './matterCrypto';
import { getMatterSyncSocketUrl } from './firmConfig';
import type { SyncFrame } from './contract';

export type SyncStatus =
  | 'idle'
  | 'connecting'
  | 'catching-up'
  | 'live'
  | 'offline'
  | 'error';

export interface MatterSyncCallbacks {
  /** Status changes — drives the UI badge. */
  onStatus?: (status: SyncStatus) => void;
  /** Fired when a Yjs update from a peer has been applied (for UI refresh). */
  onRemoteUpdate?: (doc: Y.Doc) => void;
  /**
   * The relay reported a `key_epoch` newer than ours. The host must rotate the
   * local matter key to the new epoch (provision/fetch) and then call
   * {@link MatterSyncClient.setKeyEpoch} + supply the new key. Until then,
   * newer-epoch blobs are skipped.
   */
  onKeyEpochAdvanced?: (newEpoch: number) => void;
}

/** Minimal WebSocket surface so tests can inject a fake. */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}
export type WebSocketFactory = (url: string) => WebSocketLike;

export interface MatterSyncOptions {
  matterId: string;
  /** Raw AES content key (base64) for the current epoch. */
  keyB64: string;
  keyEpoch: number;
  /** A valid, active seat token (the relay credential). */
  seatToken: string;
  /**
   * Access token for the connecting identity. NOTE: it is never put on the WS
   * URL — the client mints a single-use ticket over the authed HTTP API (whose
   * access token comes from the FirmApiClient's TokenSource) and opens the WS
   * with only that ticket. Kept here for the option shape / identity context.
   */
  accessToken?: string;
  client: FirmApiClient;
  doc?: Y.Doc;
  callbacks?: MatterSyncCallbacks;
  /** Inject a WebSocket factory (tests). Defaults to the global `WebSocket`. */
  socketFactory?: WebSocketFactory;
  /** Page size guard for catch-up (defensive; the relay also paginates). */
  maxCatchupPages?: number;
}

function genBlobId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return `blob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class MatterSyncClient {
  readonly doc: Y.Doc;
  private readonly matterId: string;
  private readonly client: FirmApiClient;
  private readonly seatToken: string;
  private readonly callbacks: MatterSyncCallbacks;
  private readonly socketFactory: WebSocketFactory | undefined;
  private readonly maxCatchupPages: number;

  private cryptoKey: CryptoKey | null = null;
  private keyB64: string;
  private keyEpoch: number;
  private cursor = 0;
  private status: SyncStatus = 'idle';
  private socket: WebSocketLike | null = null;
  private started = false;
  /** Blob ids we originated, so we don't re-apply our own echoes wastefully. */
  private readonly ownBlobIds = new Set<string>();
  private updateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null;
  /** Origin marker used when applying remote updates so we don't re-broadcast. */
  private readonly remoteOrigin = Symbol('matter-sync-remote');

  constructor(opts: MatterSyncOptions) {
    this.matterId = opts.matterId;
    this.client = opts.client;
    this.seatToken = opts.seatToken;
    this.callbacks = opts.callbacks ?? {};
    this.socketFactory = opts.socketFactory;
    this.maxCatchupPages = opts.maxCatchupPages ?? 1000;
    this.keyB64 = opts.keyB64;
    this.keyEpoch = opts.keyEpoch;
    this.doc = opts.doc ?? new Y.Doc();
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  getCursor(): number {
    return this.cursor;
  }

  getKeyEpoch(): number {
    return this.keyEpoch;
  }

  private setStatus(s: SyncStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.callbacks.onStatus?.(s);
  }

  private async ensureKey(): Promise<CryptoKey> {
    if (!this.cryptoKey) {
      this.cryptoKey = await importMatterKey(this.keyB64);
    }
    return this.cryptoKey;
  }

  /**
   * Rotate the in-memory key after a `key_epoch` bump. The host fetches/derives
   * the new-epoch key out of band (see the documented follow-up) and hands it
   * here; subsequent decrypts/encrypts use it.
   */
  async rotateKey(newKeyB64: string, newEpoch: number): Promise<void> {
    this.keyB64 = newKeyB64;
    this.keyEpoch = newEpoch;
    this.cryptoKey = null;
    await this.ensureKey();
  }

  /** Update the epoch only (e.g. after the host confirms it now holds the key). */
  setKeyEpoch(epoch: number): void {
    this.keyEpoch = epoch;
  }

  /** Start catch-up + live sync, and begin broadcasting local edits. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.ensureKey();

    // Broadcast local Yjs updates (skip ones we applied from remote).
    this.updateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin === this.remoteOrigin) return;
      void this.pushLocalUpdate(update);
    };
    this.doc.on('update', this.updateHandler);

    await this.catchUp();
    await this.openSocket();
  }

  /** Pull all updates after `cursor`, decrypt, apply. */
  private async catchUp(): Promise<void> {
    this.setStatus('catching-up');
    try {
      let pages = 0;
      // Loop while the relay says there is more beyond this page.
      for (;;) {
        const res = await this.client.pullUpdates(this.matterId, this.cursor, this.seatToken);
        if (res.key_epoch > this.keyEpoch) {
          this.callbacks.onKeyEpochAdvanced?.(res.key_epoch);
        }
        await this.applyPulled(res.updates);
        this.cursor = Math.max(this.cursor, res.cursor);
        pages += 1;
        if (!res.has_more || pages >= this.maxCatchupPages) break;
      }
    } catch {
      this.setStatus('offline');
    }
  }

  private async applyPulled(
    updates: Array<{ cursor: number; blob_id: string; key_epoch: number; ciphertext_b64: string }>,
  ): Promise<void> {
    for (const u of updates) {
      await this.applyBlob(u.ciphertext_b64, u.key_epoch, u.blob_id);
      this.cursor = Math.max(this.cursor, u.cursor);
    }
  }

  /** Decrypt one blob and apply it to the Yjs doc (origin = remote). */
  private async applyBlob(ciphertextB64: string, blobEpoch: number, blobId: string): Promise<void> {
    // A blob sealed under a newer epoch than we hold: we can't decrypt it yet.
    // Signal the host to rotate; skip for now (we'll re-pull after rotation).
    if (blobEpoch > this.keyEpoch) {
      this.callbacks.onKeyEpochAdvanced?.(blobEpoch);
      return;
    }
    const key = await this.ensureKey();
    const res = await decryptUpdate(key, ciphertextB64, blobEpoch);
    if (!res.ok) {
      // Could be an older-epoch blob our current key can't open, or tampering.
      // Skip it rather than crash the sync loop (CRDT tolerates gaps; a full
      // re-key + re-pull recovers state).
      return;
    }
    Y.applyUpdate(this.doc, res.update, this.remoteOrigin);
    if (this.ownBlobIds.has(blobId)) {
      this.ownBlobIds.delete(blobId);
    } else {
      this.callbacks.onRemoteUpdate?.(this.doc);
    }
  }

  /** Encrypt a local Yjs update and push it to the relay. */
  private async pushLocalUpdate(update: Uint8Array): Promise<void> {
    try {
      const key = await this.ensureKey();
      const ciphertext = await encryptUpdate(key, update, this.keyEpoch);
      const blobId = genBlobId();
      this.ownBlobIds.add(blobId);
      const res = await this.client.pushUpdate(
        this.matterId,
        blobId,
        ciphertext,
        this.seatToken,
        this.keyEpoch,
      );
      this.cursor = Math.max(this.cursor, res.cursor);
      if (res.key_epoch > this.keyEpoch) {
        this.callbacks.onKeyEpochAdvanced?.(res.key_epoch);
      }
    } catch {
      this.setStatus('offline');
    }
  }

  private async openSocket(): Promise<void> {
    this.setStatus('connecting');

    // Mint a single-use WS ticket over the authed HTTP API. The access + seat
    // tokens stay in headers on that request; ONLY the returned ticket rides on
    // the WS URL (no credential in a WebSocket URL → nothing leaks to a log).
    let ticket: string;
    try {
      const res = await this.client.createSyncTicket(this.matterId, this.seatToken);
      ticket = res.ticket;
    } catch {
      // Couldn't get a ticket (offline / auth lapsed): stay in catch-up-only mode.
      this.setStatus('offline');
      return;
    }
    // A stop() during the await must not then open a socket.
    if (!this.started) return;

    const url = getMatterSyncSocketUrl(this.matterId, ticket);
    let ws: WebSocketLike;
    try {
      if (this.socketFactory) {
        ws = this.socketFactory(url);
      } else if (typeof WebSocket !== 'undefined') {
        ws = new WebSocket(url) as unknown as WebSocketLike;
      } else {
        // No WebSocket (SSR/test without a factory): stay in catch-up-only mode.
        this.setStatus('offline');
        return;
      }
    } catch {
      this.setStatus('error');
      return;
    }
    this.socket = ws;

    ws.onopen = () => {
      this.setStatus('live');
    };
    ws.onmessage = (ev: { data: unknown }) => {
      void this.handleFrame(ev.data);
    };
    ws.onerror = () => {
      this.setStatus('error');
    };
    ws.onclose = () => {
      if (this.started) this.setStatus('offline');
    };
  }

  private async handleFrame(data: unknown): Promise<void> {
    let frame: SyncFrame;
    try {
      const text = typeof data === 'string' ? data : String(data);
      frame = JSON.parse(text) as SyncFrame;
    } catch {
      return;
    }
    if (frame.type === 'ready') {
      // The socket will replay backlog as `update` frames; we already caught up
      // via HTTP, and applying duplicates is a no-op, so nothing to do here.
      this.setStatus('live');
      return;
    }
    // The only remaining frame type is `update` (TS narrows it here).
    if (frame.key_epoch > this.keyEpoch) {
      this.callbacks.onKeyEpochAdvanced?.(frame.key_epoch);
    }
    await this.applyBlob(frame.ciphertext_b64, frame.key_epoch, frame.blob_id);
    this.cursor = Math.max(this.cursor, frame.cursor);
  }

  /** Stop sync and detach the Yjs listener. Idempotent. The Yjs doc is kept. */
  stop(): void {
    this.started = false;
    if (this.updateHandler) {
      this.doc.off('update', this.updateHandler);
      this.updateHandler = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
    this.setStatus('idle');
  }
}
