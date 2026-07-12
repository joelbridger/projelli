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
import { FirmApiError, type FirmApiClient } from './FirmApiClient';
import { encryptUpdateV2, decryptUpdateV2, importMatterKey } from './matterCrypto';
import { getMatterSyncSocketUrl } from './firmConfig';
import { createOpaqueBlobId, isOpaqueBlobId } from './opaqueBlobId';
import type { MatterHandle, StreamHandle, SyncFrame } from './contract';

/** Must match the relay's MAX_UPDATE_BYTES (backend/src/lib/matters.ts). */
const MAX_UPDATE_BYTES = 1024 * 1024;

function isSafeCursor(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}

/**
 * True if the value cannot possibly decode within MAX_UPDATE_BYTES. Deliberately does NOT
 * validate base64 shape/padding — that would misclassify small malformed or tampered
 * ciphertext (which must fall through to decrypt and fail there as `decrypt_failed`) as
 * oversized. `floor(dataLength * 3/4)` ignores padding entirely, which can only ever
 * OVER-estimate the true decoded size, so this can never let a genuinely oversized
 * payload through, and at worst is a couple of bytes over-strict at the exact boundary.
 * Counts only non-whitespace characters: atob() (the eventual decoder) ignores ASCII
 * whitespace, so a raw-length count would let a hostile relay pad a small, otherwise-valid
 * ciphertext with whitespace to make a legitimate update look oversized and get skipped.
 */
function exceedsUpdateByteLimit(ciphertextB64: unknown): boolean {
  if (typeof ciphertextB64 !== 'string') return true;
  const dataLength = ciphertextB64.length - (ciphertextB64.match(/\s/g)?.length ?? 0);
  return Math.floor((dataLength * 3) / 4) > MAX_UPDATE_BYTES;
}

export type SyncStatus =
  | 'idle'
  | 'connecting'
  | 'catching-up'
  | 'live'
  | 'offline'
  | 'error';

/**
 * Why a remote update was permanently skipped. `matterSyncStore.ts`'s
 * `MatterSyncQuarantineReason` is derived from this — keep this the single
 * source of truth so the two can never drift apart again.
 */
export type MatterSyncQuarantineInfo = {
  reason: 'decrypt_failed' | 'epoch_superseded' | 'yjs_apply_failed' | 'ciphertext_too_large';
  blobId: string;
} | {
  /** An untrusted relay value failed opaque-handle validation. It is never surfaced. */
  reason: 'invalid_blob_id' | 'invalid_cursor';
};

export interface MatterSyncCallbacks {
  /** Status changes — drives the UI badge. */
  onStatus?: (status: SyncStatus) => void;
  /** Fired when a Yjs update from a peer has been applied (for UI refresh). */
  onRemoteUpdate?: (doc: Y.Doc) => void;
  /** A remote update was permanently skipped but sync can continue. */
  onUpdateQuarantined?: (info: MatterSyncQuarantineInfo) => void;
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

type PendingWrite = {
  sequence: number;
  update: Uint8Array;
  /** Set exactly once: retries send this exact id and encrypted bytes. */
  blobId: string;
  ciphertext?: string;
  /** The ciphertext's AAD epoch. It must never follow a later key rotation. */
  keyEpoch?: number;
};

type PushResult =
  | { kind: 'accepted' }
  | { kind: 'rejected'; error: FirmApiError }
  | { kind: 'unknown'; error: unknown };

/**
 * True for frames that participate in ordered reconciliation: the `ready`
 * snapshot (the anchor the socket promises to complete) and every ciphertext
 * `update`. A `presence` frame is neither, so it may be applied immediately.
 */
function isReconciliationFrame(data: unknown): boolean {
  try {
    const text = typeof data === 'string' ? data : String(data);
    return (JSON.parse(text) as { type?: unknown }).type !== 'presence';
  } catch {
    return true;
  }
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
  /** One pull at a time; a key rotation waits for it then re-pulls. */
  private catchUpPromise: Promise<void> | null = null;
  /** Key rotations must never race each other or their follow-up catch-up. */
  private rotationQueue: Promise<void> = Promise.resolve();
  private presenceCount = 0;
  private status: SyncStatus = 'idle';
  private socket: WebSocketLike | null = null;
  private started = false;
  /** Local Yjs updates that failed to push, queued (in order) for retry. */
  private readonly pendingUpdates: PendingWrite[] = [];
  /** Backoff reconnect timer; non-null while a reconnect attempt is pending. */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Current backoff delay (ms). 0 means "not yet backed off" — the first
   *  scheduled reconnect uses 1s, then doubles up to a 30s cap. */
  private reconnectDelayMs = 0;
  /** Blob ids we originated, so we don't re-apply our own echoes wastefully. */
  private readonly ownBlobIds = new Set<string>();
  /** Each local edit gets a monotonic marker so flush() can snapshot a boundary. */
  private nextWriteSequence = 0;
  private readonly inFlightWrites = new Map<number, { promise: Promise<PushResult>; controller: AbortController }>();
  private updateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null;
  /** Origin marker used when applying remote updates so we don't re-broadcast. */
  private readonly remoteOrigin = Symbol('matter-sync-remote');
  /** WebSocket messages are ordered on the wire; preserve that order through async crypto too. */
  private incomingFrameQueue: Promise<void> = Promise.resolve();
  /** A failed peer frame is a cursor gap. Only a successful pull may clear it. */
  private incomingCursorBlocked = false;
  /** The ready frame's durable server snapshot. Live cursor movement is illegal
   * until HTTP/socket replay has applied through this point. */
  private socketReadyCursor: number | null = null;

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
   * This waits for a snapshot of local writes to receive HTTP acceptance.
   */
  async flush(options: { signal?: AbortSignal } = {}): Promise<void> {
    // This is deliberately a snapshot, not a global-drain operation. A busy
    // editor may continue making changes forever; document creation only needs
    // the root-index updates that existed when it called flush().
    const boundary = this.nextWriteSequence;
    const abortBoundaryWrites = () => {
      for (const [sequence, write] of this.inFlightWrites) {
        if (sequence <= boundary) write.controller.abort();
      }
    };
    options.signal?.addEventListener('abort', abortBoundaryWrites, { once: true });
    try {
      let unknownAttempts = 0;
      for (;;) {
        if (options.signal?.aborted) throw new Error('Could not publish the encrypted root update.');
        const inFlight = [...this.inFlightWrites.entries()]
          .filter(([sequence]) => sequence <= boundary)
          .map(([, write]) => write.promise);
        if (inFlight.length > 0) {
          const results = await Promise.all(inFlight);
          const rejected = results.find((result) => result.kind === 'rejected');
          if (rejected?.kind === 'rejected') throw rejected.error;
          const unknown = results.find((result) => result.kind === 'unknown');
          if (unknown?.kind === 'unknown') {
            if (options.signal?.aborted) throw new Error('Could not publish the encrypted root update.');
            if (unknownAttempts++ > 0) throw unknown.error;
          }
          continue;
        }
        if (!this.pendingUpdates.some(({ sequence }) => sequence <= boundary)) return;
        const result = await this.flushPendingUpdatesThrough(boundary, options.signal);
        if (result.kind === 'rejected' || result.kind === 'unknown') throw result.error;
      }
    } finally {
      options.signal?.removeEventListener('abort', abortBoundaryWrites);
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
    const rotation = this.rotationQueue.then(async () => {
      // A delayed notification must never roll a newer key backwards.
      if (newEpoch < this.keyEpoch) return;
      this.keyB64 = newKeyB64;
      this.keyEpoch = newEpoch;
      this.cryptoKey = null;
      await this.ensureKey();

      // A newer-epoch blob may have stopped an in-flight pull. Wait for that
      // pull to finish, then begin again at the last *applied* cursor.
      const inFlight = this.catchUpPromise;
      if (inFlight) await inFlight;
      await this.catchUp();
    });
    // Keep the queue usable after a transient network failure, while returning
    // the real error to the caller that requested this rotation.
    this.rotationQueue = rotation.then(() => undefined, () => undefined);
    return rotation;
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
      const sequence = ++this.nextWriteSequence;
      const write: PendingWrite = { sequence, update, blobId: createOpaqueBlobId() };
      if (this.pendingUpdates.length > 0) {
        this.pendingUpdates.push(write);
        return;
      }
      this.startInFlightWrite(write);
    };
    this.doc.on('update', this.updateHandler);

    await this.catchUp();
    await this.openSocket();
  }

  /** Pull all updates after `cursor`, decrypt, apply. Filtered to this.docId. */
  private async catchUp(): Promise<void> {
    if (this.catchUpPromise) return this.catchUpPromise;
    const pull = this.doCatchUp();
    this.catchUpPromise = pull;
    try {
      await pull;
    } finally {
      if (this.catchUpPromise === pull) this.catchUpPromise = null;
    }
  }

  private async doCatchUp(): Promise<void> {
    this.setStatus('catching-up');
    try {
      let pages = 0;
      // Loop while the relay says there is more beyond this page.
      for (;;) {
        const res = await this.client.pullUpdates(this.streamHandle, this.cursor, this.seatToken);
        if (res.key_epoch > this.keyEpoch) {
          this.callbacks.onKeyEpochAdvanced?.(res.key_epoch);
        }
        const fullyApplied = await this.applyPulled(res.updates);
        // Never acknowledge a cursor beyond ciphertext we could open. A later
        // rotation starts from this last applied position and gets the blob
        // again instead of permanently losing it.
        if (!fullyApplied) break;
        // A pull is ordered by the relay. Reaching its end proves there is no
        // outstanding earlier peer frame, so live delivery may resume.
        this.incomingCursorBlocked = false;
        pages += 1;
        if (!res.has_more || pages >= this.maxCatchupPages) break;
      }
    } catch {
      this.setStatus('offline');
    }
  }

  private async applyPulled(
    updates: Array<{ cursor: number; blob_id: string; key_epoch: number; ciphertext_b64: string }>,
  ): Promise<boolean> {
    for (const u of updates) {
      // A cursor chooses our next replay position. Unlike a bad blob ID, there
      // is no trusted value to advance to, so quarantine and leave the stream
      // blocked rather than desynchronizing this client.
      if (!isSafeCursor(u.cursor)) {
        this.logInvalidCursor();
        return false;
      }
      // The relay is untrusted. Never pass an arbitrary relay-supplied ID to
      // crypto, local logs, or callbacks; an invalid ID is permanently corrupt
      // just like an unauthenticated ciphertext, so quarantine and advance.
      if (!isOpaqueBlobId(u.blob_id)) {
        this.logInvalidBlobId(u.cursor);
        this.cursor = u.cursor;
        continue;
      }
      // The relay's page-size budget bounds the aggregate response, not any
      // one entry within it — the same per-blob limit the live socket path
      // enforces must apply here too, before this ciphertext is decrypted.
      if (exceedsUpdateByteLimit(u.ciphertext_b64)) {
        this.logQuarantinedUpdate('ciphertext_too_large', u.blob_id, u.cursor, undefined);
        this.cursor = u.cursor;
        continue;
      }
      const applied = await this.applyBlob(u.ciphertext_b64, u.key_epoch, u.blob_id, u.cursor);
      if (!applied) return false;
      this.cursor = u.cursor;
    }
    return true;
  }

  /** Decrypt one blob and apply it to the Yjs doc (origin = remote). */
  private async applyBlob(
    ciphertextB64: string,
    blobEpoch: number,
    blobId: string,
    cursor?: number,
  ): Promise<boolean> {
    // A blob sealed under a newer epoch than we hold: we can't decrypt it yet.
    // Signal the host to rotate; skip for now (we'll re-pull after rotation).
    if (blobEpoch > this.keyEpoch) {
      this.callbacks.onKeyEpochAdvanced?.(blobEpoch);
      return false;
    }
    const key = await this.ensureKey();
    const res = await decryptUpdateV2(key, ciphertextB64, {
      keyEpoch: blobEpoch, matterHandle: this.matterHandle, streamHandle: this.streamHandle,
    });
    if (!res.ok) {
      // This is deliberately different from the newer-epoch branch above.
      // A current-epoch decrypt failure is a corruption candidate. Older-epoch
      // ciphertext can be a legitimate update, but this client stores only one
      // current key, so it cannot recover it after rotation. In both cases we
      // quarantine and advance: one bad or unrecoverable blob must not wedge
      // every honest member on this stream forever.
      this.logQuarantinedUpdate(blobEpoch === this.keyEpoch ? 'decrypt_failed' : 'epoch_superseded', blobId, cursor, res.reason);
      return true;
    }
    try {
      Y.applyUpdate(this.doc, res.update, this.remoteOrigin);
    } catch (error) {
      // Authenticated ciphertext can still carry bytes which Yjs cannot
      // decode. It is permanently corrupt for this document just like a
      // decrypt failure, so it must never escape and wedge reconciliation.
      this.logQuarantinedUpdate('yjs_apply_failed', blobId, cursor, error);
      return true;
    }
    if (this.ownBlobIds.has(blobId)) {
      this.ownBlobIds.delete(blobId);
    } else {
      this.callbacks.onRemoteUpdate?.(this.doc);
    }
    return true;
  }

  private logQuarantinedUpdate(
    reason: 'decrypt_failed' | 'epoch_superseded' | 'yjs_apply_failed' | 'ciphertext_too_large',
    blobId: string,
    cursor: number | undefined,
    detail: unknown,
  ): void {
    const message = reason === 'epoch_superseded'
      ? '[MatterSyncClient] skipped remote update sealed under a superseded key epoch'
      : reason === 'ciphertext_too_large'
        ? '[MatterSyncClient] quarantined oversized remote update'
      : '[MatterSyncClient] quarantined corrupt remote update';
    console.error(message, {
      reason,
      matterHandle: this.matterHandle,
      streamHandle: this.streamHandle,
      blobId,
      cursor: cursor ?? this.cursor,
      detail,
    });
    this.callbacks.onUpdateQuarantined?.({ reason, blobId });
  }

  /**
   * Quarantine an invalid relay-provided blob ID without ever retaining or
   * surfacing its raw, attacker-controlled text.
   */
  private logInvalidBlobId(cursor: number): void {
    console.error('[MatterSyncClient] quarantined remote update with invalid blob id', {
      reason: 'invalid_blob_id',
      matterHandle: this.matterHandle,
      streamHandle: this.streamHandle,
      cursor,
    });
    this.callbacks.onUpdateQuarantined?.({ reason: 'invalid_blob_id' });
  }

  /** Never expose an invalid relay cursor, or use it to advance replay. */
  private logInvalidCursor(): void {
    console.error('[MatterSyncClient] quarantined remote update with invalid cursor', {
      reason: 'invalid_cursor',
      matterHandle: this.matterHandle,
      streamHandle: this.streamHandle,
      cursor: '[invalid relay cursor]',
    });
    this.callbacks.onUpdateQuarantined?.({ reason: 'invalid_cursor' });
  }

  /**
   * Encrypt a local Yjs update and push it to the relay under this.docId.
   * Returns false (and sets `offline`) on failure so callers can queue the
   * update for retry instead of silently dropping it.
   */
  private startInFlightWrite(write: PendingWrite): void {
    const controller = new AbortController();
    const promise = this.pushLocalUpdate(write, controller.signal);
    this.inFlightWrites.set(write.sequence, { promise, controller });
    void promise.then((result) => {
      this.inFlightWrites.delete(write.sequence);
      if (result.kind !== 'accepted') {
        this.pendingUpdates.push(write);
        this.pendingUpdates.sort((a, b) => a.sequence - b.sequence);
        if (result.kind === 'unknown') this.scheduleReconnect();
      }
    });
  }

  private async pushLocalUpdate(write: PendingWrite, signal?: AbortSignal): Promise<PushResult> {
    try {
      if (!write.ciphertext) {
        const key = await this.ensureKey();
        write.keyEpoch = this.keyEpoch;
        write.ciphertext = await encryptUpdateV2(key, write.update, {
          keyEpoch: write.keyEpoch, matterHandle: this.matterHandle, streamHandle: this.streamHandle,
        });
      }
      this.ownBlobIds.add(write.blobId);
      const res = await this.client.pushUpdate(
        this.matterHandle,
        this.streamHandle,
        write.blobId,
        write.ciphertext,
        this.seatToken,
        write.keyEpoch ?? this.keyEpoch,
        signal,
      );
      // A push acknowledgement proves only that our own ciphertext reached
      // the relay. It says nothing about earlier peer frames we have not yet
      // decrypted, so it must never move the pull cursor.
      if (res.key_epoch > this.keyEpoch) {
        this.callbacks.onKeyEpochAdvanced?.(res.key_epoch);
      }
      return { kind: 'accepted' };
    } catch (error) {
      // A 4xx is a definite relay decision. Everything else (including abort)
      // may have committed after the client lost the response, so retain the
      // exact blob id + ciphertext for an idempotent retry.
      if (error instanceof FirmApiError && error.status >= 400 && error.status < 500) {
        this.ownBlobIds.delete(write.blobId);
        return { kind: 'rejected', error };
      }
      this.setStatus('offline');
      return { kind: 'unknown', error };
    }
  }

  /**
   * Retry queued local updates in order (FIFO). Stops at the first failure
   * and leaves the remainder queued, re-arming a reconnect/retry timer so a
   * push that keeps failing (independent of the WebSocket's own health)
   * doesn't strand the queue with nothing left to wake it back up.
   */
  private async flushPendingUpdatesThrough(boundary: number, signal?: AbortSignal): Promise<PushResult> {
    for (;;) {
      if (signal?.aborted) return { kind: 'unknown', error: new Error('Could not publish the encrypted root update.') };
      const nextIndex = this.pendingUpdates.findIndex(({ sequence }) => sequence <= boundary);
      if (nextIndex < 0) break;
      const next = this.pendingUpdates[nextIndex];
      if (next === undefined) return { kind: 'accepted' };
      const result = await this.pushLocalUpdate(next, signal);
      if (result.kind !== 'accepted') {
        if (result.kind === 'unknown') this.scheduleReconnect();
        return result;
      }
      this.pendingUpdates.splice(nextIndex, 1);
    }
    // Drained cleanly. If the socket itself was never actually disconnected
    // (this was a push-only failure — openSocket()'s reconnect guard means it
    // never ran again), `pushLocalUpdate`'s earlier failure left `status`
    // stuck on 'offline' with nothing else left to correct it — restore it
    // now that pushes are working again.
    if (this.socket) this.setStatus('live');
    return { kind: 'accepted' };
  }

  private flushPendingUpdates(): Promise<PushResult> {
    return this.flushPendingUpdatesThrough(Number.POSITIVE_INFINITY);
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
    await this.catchUp();
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
      const res = await this.client.createSyncTicket(this.streamHandle, this.seatToken, this.cursor);
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
      void this.flushPendingUpdates();
    };
    ws.onmessage = (ev: { data: unknown }) => {
      if (this.socket !== ws) return;
      // The ready snapshot and every following update share one queue. This
      // prevents a newer live frame from overtaking the reconciliation it
      // promises the socket will complete.
      //
      // `presence` is deliberately NOT queued: it carries no ciphertext, no
      // cursor, and takes no part in reconciliation, so queueing it behind a
      // slow decrypt would stall the live editor count for no benefit. An
      // unparseable frame still takes the queue — "cannot parse" never means
      // "safe to apply out of order".
      if (!isReconciliationFrame(ev.data)) {
        void this.handleFrame(ev.data);
        return;
      }
      this.incomingFrameQueue = this.incomingFrameQueue
        .then(() => this.handleFrame(ev.data))
        .catch(() => undefined);
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
      if (!isSafeCursor(frame.latest_cursor)) {
        this.logInvalidCursor();
        this.incomingCursorBlocked = true;
        this.setStatus('offline');
        return;
      }
      // The server has subscribed us before sending this snapshot. Reconcile
      // through its high-water mark before any later live frame can move the
      // cursor. This also covers a replay page capped at 500 updates.
      this.socketReadyCursor = frame.latest_cursor;
      this.presenceCount = frame.subscribers;
      this.callbacks.onPresenceCount?.(frame.subscribers);
      if (await this.reconcileThrough(frame.latest_cursor)) {
        this.socketReadyCursor = null;
        this.incomingCursorBlocked = false;
        this.setStatus('live');
      } else {
        this.incomingCursorBlocked = true;
        this.setStatus('offline');
      }
      return;
    }
    if (frame.type === 'presence') {
      // Relay-broadcast presence count update (peer joined or left).
      this.presenceCount = frame.count;
      this.callbacks.onPresenceCount?.(frame.count);
      return;
    }
    // The only remaining frame type is `update`; stream context comes from the ticket.
    // Once a peer frame cannot be opened, later frames are not allowed to leap
    // over it. rotateKey() re-pulls from this last contiguous cursor.
    if (this.incomingCursorBlocked) return;
    if (this.socketReadyCursor !== null && this.cursor < this.socketReadyCursor) {
      // Defensive belt-and-suspenders: a ready reconciliation should run first
      // because frames are queued, but never permit a live frame to leap over
      // its promised replay snapshot if a future transport changes ordering.
      if (!(await this.reconcileThrough(this.socketReadyCursor))) {
        this.incomingCursorBlocked = true;
        return;
      }
      this.socketReadyCursor = null;
    }
    // Validate before relay values can reach logging, callbacks, comparisons,
    // or cursor advancement. There is no safe recovery position for a bad
    // cursor, so leave this stream blocked instead of skipping past it.
    if (!isSafeCursor(frame.cursor)) {
      this.logInvalidCursor();
      this.incomingCursorBlocked = true;
      return;
    }
    // Validate before the relay-provided ID can reach any later handling,
    // including quarantine logging or callback payloads. Advancing the cursor
    // keeps one permanently malformed live frame from wedging the stream.
    if (!isOpaqueBlobId(frame.blob_id)) {
      this.logInvalidBlobId(frame.cursor);
      if (frame.cursor > this.cursor) this.cursor = frame.cursor;
      return;
    }
    // Do this before base64 decoding or crypto. The relay limits stored blobs
    // to 1 MiB, and live frames must enforce the same limit independently.
    if (exceedsUpdateByteLimit(frame.ciphertext_b64)) {
      this.logQuarantinedUpdate('ciphertext_too_large', frame.blob_id, frame.cursor, undefined);
      if (frame.cursor > this.cursor) this.cursor = frame.cursor;
      return;
    }
    if (frame.key_epoch > this.keyEpoch) {
      this.callbacks.onKeyEpochAdvanced?.(frame.key_epoch);
    }
    if (await this.applyBlob(frame.ciphertext_b64, frame.key_epoch, frame.blob_id, frame.cursor)) {
      if (frame.cursor > this.cursor) this.cursor = frame.cursor;
    } else {
      this.incomingCursorBlocked = true;
    }
  }

  /** Pull until the server snapshot has been fully and successfully applied.
   * This deliberately does not trust the 500-frame socket replay as complete. */
  private async reconcileThrough(target: number): Promise<boolean> {
    try {
      while (this.cursor < target) {
        const res = await this.client.pullUpdates(this.streamHandle, this.cursor, this.seatToken);
        if (res.key_epoch > this.keyEpoch) this.callbacks.onKeyEpochAdvanced?.(res.key_epoch);
        if (!(await this.applyPulled(res.updates))) return false;
        // No result can prove a cursor gap has been filled. Stay blocked rather
        // than letting a later live frame hide a missing encrypted blob.
        if (res.updates.length === 0) return false;
      }
      return true;
    } catch {
      return false;
    }
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
