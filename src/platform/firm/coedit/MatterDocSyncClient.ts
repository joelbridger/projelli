/**
 * MatterDocSyncClient — doc-scoped E2EE transport for live co-editing.
 *
 * A thin facade over `MatterSyncClient` that binds a specific `(matterId, docId)`
 * pair to a `Y.Doc`. This is the transport half of the Wave 4 live co-editing
 * feature; the CRDT model lives in `docCrdt.ts`.
 *
 * Design approach: COMPOSE rather than duplicate.
 * `MatterSyncClient` (Task 7) is now docId-aware: it accepts an optional `docId`
 * (default `_notes`), threads it through push/pull/ticket/WS, and exposes the
 * underlying `doc: Y.Doc`. `MatterDocSyncClient` simply constructs a
 * `MatterSyncClient` with the given `docId` + `doc` and delegates all transport
 * concerns to it. This avoids duplicating crypto, socket, catch-up, or fan-out
 * logic.
 *
 * Same matter key + epoch:
 * Co-editing blobs and notes blobs share the per-matter AES-256 key (same
 * `matterCrypto.encryptUpdate`/`decryptUpdate` path). Only the `doc_id` stream
 * distinguishes them on the relay.
 *
 * Usage:
 * ```ts
 * const client = new MatterDocSyncClient({
 *   matterId, docId, doc,
 *   keyB64, keyEpoch, seatToken, client: firmApiClient,
 * });
 * await client.start();          // catch up + go live
 * // …edits flow automatically…
 * client.stop();                 // detach + close socket
 * ```
 */

import * as Y from 'yjs';
import { MatterSyncClient, type MatterSyncCallbacks, type WebSocketFactory, type SyncStatus } from '@/platform/firm/MatterSyncClient';
import type { FirmApiClient } from '@/platform/firm/FirmApiClient';

export interface MatterDocSyncOptions {
  matterId: string;
  /**
   * The document stream id. Use a hex digest of the matter-relative file path
   * (see design §7). Must NOT be `'_notes'` (reserved for the notes stream).
   */
  docId: string;
  /** The Y.Doc to sync. Typically built by `documentJsonToYDoc`. */
  doc: Y.Doc;
  /** Raw AES-256 content key (base64) for the current epoch. */
  keyB64: string;
  keyEpoch: number;
  /** A valid, active seat token (the relay credential). */
  seatToken: string;
  /** Optional access token for identity context. */
  accessToken?: string;
  client: FirmApiClient;
  callbacks?: MatterSyncCallbacks;
  /** Inject a WebSocket factory (tests). Defaults to the global `WebSocket`. */
  socketFactory?: WebSocketFactory;
  /** Page size guard for catch-up. */
  maxCatchupPages?: number;
}

/**
 * Doc-scoped E2EE sync client for a single `(matterId, docId)` pair.
 *
 * Internally constructs a `MatterSyncClient` with the given `docId` and `doc`,
 * so all transport (encrypt, push, pull, socket, key epoch rotation) is handled
 * by the existing, tested `MatterSyncClient` implementation. No crypto is
 * duplicated here.
 */
export class MatterDocSyncClient {
  /** The underlying Y.Doc. Read-only externally; edit via docCrdt mutators. */
  readonly doc: Y.Doc;

  private readonly inner: MatterSyncClient;

  constructor(opts: MatterDocSyncOptions) {
    this.doc = opts.doc;

    // Delegate all transport to MatterSyncClient, supplying:
    //   - docId  → scopes push/pull/WS to this document stream
    //   - doc    → the same Y.Doc instance; MatterSyncClient wires update listeners
    //              and applies incoming decrypted updates using its remoteOrigin sentinel
    // Build the options object, omitting optional properties when undefined so
    // that exactOptionalPropertyTypes is satisfied (don't pass key: undefined).
    const syncOpts: import('@/platform/firm/MatterSyncClient').MatterSyncOptions = {
      matterId:  opts.matterId,
      docId:     opts.docId,
      doc:       opts.doc,
      keyB64:    opts.keyB64,
      keyEpoch:  opts.keyEpoch,
      seatToken: opts.seatToken,
      client:    opts.client,
    };
    if (opts.accessToken !== undefined)    syncOpts.accessToken    = opts.accessToken;
    if (opts.callbacks !== undefined)      syncOpts.callbacks      = opts.callbacks;
    if (opts.socketFactory !== undefined)  syncOpts.socketFactory  = opts.socketFactory;
    if (opts.maxCatchupPages !== undefined) syncOpts.maxCatchupPages = opts.maxCatchupPages;

    this.inner = new MatterSyncClient(syncOpts);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Start sync: catch up the relay's existing history for this (matter, docId),
   * then go live on the WS. Local Y.Doc updates are encrypted and pushed
   * automatically. Idempotent (safe to call twice; only starts once).
   */
  async start(): Promise<void> {
    return this.inner.start();
  }

  /**
   * Stop sync and detach all listeners. Idempotent. The Y.Doc is kept intact;
   * the caller is responsible for snapshotting if needed.
   */
  stop(): void {
    this.inner.stop();
  }

  // ── Key rotation ──────────────────────────────────────────────────────────

  /**
   * Rotate the in-memory key after a `key_epoch` bump (mirrors MatterSyncClient).
   * Call when `callbacks.onKeyEpochAdvanced` fires and the new key is available.
   */
  async rotateKey(newKeyB64: string, newEpoch: number): Promise<void> {
    return this.inner.rotateKey(newKeyB64, newEpoch);
  }

  /** Update the epoch only (after the host confirms it holds the new key). */
  setKeyEpoch(epoch: number): void {
    this.inner.setKeyEpoch(epoch);
  }

  // ── Observability ─────────────────────────────────────────────────────────

  getStatus(): SyncStatus {
    return this.inner.getStatus();
  }

  getCursor(): number {
    return this.inner.getCursor();
  }

  getKeyEpoch(): number {
    return this.inner.getKeyEpoch();
  }

  /** Returns the last known total subscriber count from the relay (includes self). */
  getPresenceCount(): number {
    return this.inner.getPresenceCount();
  }
}
