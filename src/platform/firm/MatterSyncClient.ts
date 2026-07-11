/**
 * MatterSyncClient — the E2EE collaboration client for one shared matter.
 *
 * Drives a single Yjs document representing a shared matter's collaborative
 * state. The relay (backend) is a DUMB PIPE that only ever sees opaque
 * ciphertext; all encryption/decryption happens here with the per-matter key.
 *
 * Lifecycle (`start()`):
 *   1. Catch up: stream-scoped v2 updates (paged), decrypt each
 *      blob, apply to the Yjs doc, advance the cursor.
 *   2. Live: open the fixed v2 sync socket with a redeemed ticket; the relay sends a `ready` frame then
 *      backlog + live `update` frames. Decrypt + apply each; advance the cursor.
 *   3. Send: on a local Yjs update, encrypt it under the matter key + current
 *      `key_epoch` and a stream-scoped v2 update. The relay never sees plaintext.
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
import { encryptUpdateV2, decryptUpdateV2, importMatterKey } from './matterCrypto';
import { getMatterSyncSocketUrl } from './firmConfig';
import type { MatterHandle, StreamHandle, SyncFrame } from './contract';

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
  /**
   * Fired when the relay broadcasts a presence frame (join/leave) or when the
   * ready frame includes a subscriber count. `count` is the TOTAL number of
   * connected subscribers including this client (so `count - 1` = other editors).
   */
  onPresenceCount?: (count: number) => void;
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
  /** Opaque relay context. Local Matter and document IDs must never be passed here. */
  matterHandle: MatterHandle;
  streamHandle: StreamHandle;
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
  private readonly matterHandle: MatterHandle;
  private readonly streamHandle: StreamHandle;
  private readonly client: FirmApiClient;
  private readonly seatToken: string;
  private readonly callbacks: MatterSyncCallbacks;
  private readonly socketFactory: WebSocketFactory | undefined;
  private readonly maxCatchupPages: number;

  private cryptoKey: CryptoKey | null = null;
  private keyB64: string;
  private keyEpoch: number;
  private cursor = 0;
  private presenceCount = 0;
  private status: SyncStatus = 'idle';
  private socket: WebSocketLike | null = null;
  private started = false;
  /** Local Yjs updates that failed to push, queued (in order) for retry. */
  private readonly pendingUpdates: Uint8Array[] = [];
  /** Backoff reconnect timer; non-null while a reconnect attempt is pending. */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Current backoff delay (ms). 0 means "not yet backed off" — the first
   *  scheduled reconnect uses 1s, then doubles up to a 30s cap. */
  private reconnectDelayMs = 0;
  /** Blob ids we originated, so we don't re-apply our own echoes wastefully. */
  private readonly ownBlobIds = new Set<string>();
  private readonly inFlightWrites = new Set<Promise<boolean>>();
  private updateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null;
  /** Origin marker used when applying remote updates so we don't re-broadcast. */
  private readonly remoteOrigin = Symbol('matter-sync-remote');

  constructor(opts: MatterSyncOptions) {
    this.matterHandle = opts.matterHandle;
    this.streamHandle = opts.streamHandle;
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

  /** Returns the last known total subscriber count from the relay (includes self). */
  getPresenceCount(): number {
    return this.presenceCount;
  }

  /**
   * Wait for local root-index writes to receive their HTTP acceptance.
   *
   * This is a durability boundary: callers use it before exposing a newly
   * allocated document stream. A queued retry is not acceptance, so never
   * report success while any update is still waiting to be accepted.
   */
  async flush(): Promise<void> {
    for (;;) {
      while (this.inFlightWrites.size > 0) {
        await Promise.all([...this.inFlightWrites]);
      }
      if (!await this.flushPendingUpdates()) {
        throw new Error('Could not publish the encrypted root update.');
      }
      // A local Yjs update can arrive while we await an acceptance. Do not
      // expose the caller's durability boundary until that write is accepted,
      // too.
      if (this.inFlightWrites.size === 0 && this.pendingUpdates.length === 0) return;
    }
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
      // If there's already a backlog, queue behind it rather than racing a
      // fresh push ahead of updates still waiting to be sent.
      if (this.pendingUpdates.length > 0) {
        this.pendingUpdates.push(update);
        return;
      }
      const write = this.pushLocalUpdate(update);
      this.inFlightWrites.add(write);
      void write.then((ok) => {
        this.inFlightWrites.delete(write);
        if (!ok) {
          this.pendingUpdates.push(update);
          this.scheduleReconnect();
        }
      });
    };
    this.doc.on('update', this.updateHandler);

    await this.catchUp();
    await this.openSocket();
  }

  /** Pull all updates after `cursor`, decrypt, apply. Filtered to this.docId. */
  private async catchUp(): Promise<void> {
    this.setStatus('catching-up');
    try {
      let pages = 0;
      // Loop while the relay says there is more beyond this page.
      for (;;) {
        const res = await this.client.pullUpdates(this.streamHandle, this.cursor, this.seatToken);
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
    const res = await decryptUpdateV2(key, ciphertextB64, {
      keyEpoch: blobEpoch, matterHandle: this.matterHandle, streamHandle: this.streamHandle,
    });
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

  /**
   * Encrypt a local Yjs update and push it to the relay under this.docId.
   * Returns false (and sets `offline`) on failure so callers can queue the
   * update for retry instead of silently dropping it.
   */
  private async pushLocalUpdate(update: Uint8Array): Promise<boolean> {
    let blobId: string | undefined;
    try {
      const key = await this.ensureKey();
      const ciphertext = await encryptUpdateV2(key, update, {
        keyEpoch: this.keyEpoch, matterHandle: this.matterHandle, streamHandle: this.streamHandle,
      });
      blobId = genBlobId();
      this.ownBlobIds.add(blobId);
      const res = await this.client.pushUpdate(
        this.streamHandle,
        blobId,
        ciphertext,
        this.seatToken,
        this.keyEpoch,
      );
      this.cursor = Math.max(this.cursor, res.cursor);
      if (res.key_epoch > this.keyEpoch) {
        this.callbacks.onKeyEpochAdvanced?.(res.key_epoch);
      }
      return true;
    } catch {
      // This blob never received an acceptance response, so it must not stay
      // in the self-echo set while the logical update is retried with a fresh
      // blob id.
      if (blobId) this.ownBlobIds.delete(blobId);
      this.setStatus('offline');
      return false;
    }
  }

  /**
   * Retry queued local updates in order (FIFO). Stops at the first failure
   * and leaves the remainder queued, re-arming a reconnect/retry timer so a
   * push that keeps failing (independent of the WebSocket's own health)
   * doesn't strand the queue with nothing left to wake it back up.
   */
  private async flushPendingUpdates(): Promise<boolean> {
    while (this.pendingUpdates.length > 0) {
      const next = this.pendingUpdates[0];
      if (next === undefined) return true;
      const ok = await this.pushLocalUpdate(next);
      if (!ok) {
        this.scheduleReconnect();
        return false;
      }
      this.pendingUpdates.shift();
    }
    // Drained cleanly. If the socket itself was never actually disconnected
    // (this was a push-only failure — openSocket()'s reconnect guard means it
    // never ran again), `pushLocalUpdate`'s earlier failure left `status`
    // stuck on 'offline' with nothing else left to correct it — restore it
    // now that pushes are working again.
    if (this.socket) this.setStatus('live');
    return true;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Schedule a reconnect + pending-update flush with exponential backoff
   * (1s, 2s, 4s, ... capped at 30s) while the client remains started. A
   * no-op if a reconnect is already scheduled.
   */
  private scheduleReconnect(): void {
    if (!this.started || this.reconnectTimer) return;
    this.reconnectDelayMs = this.reconnectDelayMs === 0 ? 1000 : Math.min(this.reconnectDelayMs * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.started) void this.reconnectNow();
    }, this.reconnectDelayMs);
  }

  private async reconnectNow(): Promise<void> {
    await this.flushPendingUpdates();
    await this.openSocket();
  }

  private async openSocket(): Promise<void> {
    // A socket is already open or in flight — never open a second one. Without
    // this, a reconnect triggered by something OTHER than a real socket close
    // (a failed HTTP push, or `onerror` firing before `onclose`) could stand
    // up a duplicate live WebSocket subscription alongside the still-live one.
    if (this.socket) return;

    this.setStatus('connecting');

    // Mint a single-use WS ticket over the authed HTTP API. The access + seat
    // tokens stay in headers on that request; ONLY the returned ticket rides on
    // the WS URL (no credential in a WebSocket URL → nothing leaks to a log).
    let ticket: string;
    try {
      const res = await this.client.createSyncTicket(this.streamHandle, this.seatToken);
      ticket = res.ticket;
    } catch {
      // Couldn't get a ticket (offline / auth lapsed): stay in catch-up-only
      // mode, but keep trying — otherwise the client is stuck offline forever.
      this.setStatus('offline');
      if (this.started) this.scheduleReconnect();
      return;
    }
    // A stop() during the await must not then open a socket.
    if (!this.started) return;

    const url = getMatterSyncSocketUrl(ticket);
    let ws: WebSocketLike;
    try {
      if (this.socketFactory) {
        ws = this.socketFactory(url);
      } else if (typeof WebSocket !== 'undefined') {
        ws = new WebSocket(url) as unknown as WebSocketLike;
      } else {
        // No WebSocket (SSR/test without a factory): stay in catch-up-only mode.
        this.setStatus('offline');
        // scheduleReconnect() itself no-ops if `started` has flipped false;
        // no need to re-check it here (nothing async intervenes since the
        // `!this.started` guard above).
        this.scheduleReconnect();
        return;
      }
    } catch {
      this.setStatus('error');
      this.scheduleReconnect();
      return;
    }
    this.socket = ws;

    // Every handler below is identity-checked against `ws` — with the
    // openSocket() re-entrancy guard above, `this.socket` only ever points at
    // the CURRENT socket, so a stale/late event from a socket that's already
    // been superseded (or explicitly stopped) is a no-op instead of
    // clobbering the newer connection's state.
    ws.onopen = () => {
      if (this.socket !== ws) return;
      // Connectivity is back — reset backoff and flush anything queued while
      // we were offline so teammates aren't silently missing changes.
      this.reconnectDelayMs = 0;
      this.setStatus('live');
      void this.flushPendingUpdates();
    };
    ws.onmessage = (ev: { data: unknown }) => {
      if (this.socket !== ws) return;
      void this.handleFrame(ev.data);
    };
    ws.onerror = () => {
      if (this.socket !== ws) return;
      // Treat an error as dead-and-gone immediately (rather than waiting on a
      // possibly-delayed `close`) so openSocket()'s re-entrancy guard doesn't
      // block the reconnect this schedules.
      this.socket = null;
      this.setStatus('error');
      if (this.started) this.scheduleReconnect();
    };
    ws.onclose = () => {
      if (this.socket !== ws) return;
      this.socket = null;
      if (this.started) {
        this.setStatus('offline');
        this.scheduleReconnect();
      }
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
      this.presenceCount = frame.subscribers;
      this.callbacks.onPresenceCount?.(frame.subscribers);
      this.setStatus('live');
      return;
    }
    if (frame.type === 'presence') {
      // Relay-broadcast presence count update (peer joined or left).
      this.presenceCount = frame.count;
      this.callbacks.onPresenceCount?.(frame.count);
      return;
    }
    // The only remaining frame type is `update`; stream context comes from the ticket.
    if (frame.key_epoch > this.keyEpoch) {
      this.callbacks.onKeyEpochAdvanced?.(frame.key_epoch);
    }
    await this.applyBlob(frame.ciphertext_b64, frame.key_epoch, frame.blob_id);
    this.cursor = Math.max(this.cursor, frame.cursor);
  }

  /** Stop sync and detach the Yjs listener. Idempotent. The Yjs doc is kept. */
  stop(): void {
    this.started = false;
    this.clearReconnectTimer();
    this.reconnectDelayMs = 0;
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
