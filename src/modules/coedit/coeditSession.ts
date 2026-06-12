/**
 * coeditSession — per-(matter, doc) singleton lifecycle manager for live co-editing.
 *
 * Each (matterId, docId) pair gets at most ONE CoeditSession. This module owns
 * that session cache. Call `openCoeditSession` to get (or create) the session;
 * call `closeCoeditSession` / `session.close()` to tear it down on unmount
 * or sign-out.
 *
 * Mirrors matterNotesSync.ts exactly:
 *   - clientCache: resolved sessions keyed by `${matterId}::${docId}`
 *   - pendingCache: promise-singleton guard (React StrictMode double-effect safety)
 *
 * Join-or-seed logic:
 *   After MatterDocSyncClient.start() completes catch-up, inspect the Y.Doc:
 *   - If doc body is non-empty → the relay had state → JOIN (relay wins, do NOT seed)
 *   - If doc body is empty AND initialJson is provided → SEED from initialJson
 *   - If doc body is empty AND no initialJson → leave empty
 */

import * as Y from 'yjs';
import { MatterDocSyncClient } from '@/modules/coedit/MatterDocSyncClient';
import {
  documentJsonToYDoc,
  yDocToDocumentJson,
} from '@/modules/coedit/docCrdt';
import type { DocumentJson } from '@/types/docx';
import type { FirmApiClient } from '@/modules/firm/FirmApiClient';
import type { WebSocketFactory } from '@/modules/firm/MatterSyncClient';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CoeditSessionOptions {
  matterId: string;
  docId: string;
  fileName: string;
  /** Initial document JSON to seed from if the relay is empty. */
  initialJson?: DocumentJson;
  /** AES-256 matter key (base64) for the current epoch. */
  keyB64: string;
  keyEpoch: number;
  seatToken: string;
  accessToken?: string;
  client: FirmApiClient;
  /** Optional WebSocket factory (for tests). Defaults to global WebSocket. */
  socketFactory?: WebSocketFactory;
  maxCatchupPages?: number;
}

export interface CoeditSession {
  /** The live Y.Doc (read-only; edit via docCrdt mutators or directly). */
  readonly doc: Y.Doc;
  /** Return the current converged DocumentJson. */
  getDocumentJson(): DocumentJson;
  /**
   * Subscribe to any update (local or remote). Returns an unsubscribe function.
   */
  onChange(cb: () => void): () => void;
  /**
   * Count of OTHER editors connected to this doc's relay channel.
   * Self is excluded (relay count minus 1, floored at 0).
   */
  getOtherEditorCount(): number;
  /**
   * Subscribe to relay-based presence count changes. The callback receives the
   * count of OTHER editors (self excluded). Returns an unsubscribe function.
   */
  onPresenceChange(cb: (otherCount: number) => void): () => void;
  /** Snapshot state and tear down. Clears singleton caches. */
  close(): void;
}

// ---------------------------------------------------------------------------
// Singleton caches (mirrors matterNotesSync.ts clientCache + pendingCache)
// ---------------------------------------------------------------------------

/** One resolved CoeditSession per `${matterId}::${docId}`. */
const clientCache = new Map<string, CoeditSession>();

/**
 * Promise-singleton cache: keyed at function entry so concurrent calls share
 * the same construction promise and never double-construct a WebSocket client.
 * The entry is deleted on resolution/error so a retry can try again.
 */
const pendingCache = new Map<string, Promise<CoeditSession>>();

function cacheKey(matterId: string, docId: string): string {
  return `${matterId}::${docId}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open (or return the cached) CoeditSession for the given (matter, doc) pair.
 *
 * Singleton: concurrent calls for the same (matterId, docId) share a single
 * construction promise (pendingCache guard), matching the matterNotesSync.ts
 * pattern for React StrictMode double-effect safety.
 *
 * Join-or-seed: after MatterDocSyncClient.start() completes catch-up —
 *   - If the doc body is non-empty: relay state wins; initialJson is NOT applied.
 *   - If the doc body is empty and initialJson is provided: seed from initialJson.
 */
export function openCoeditSession(opts: CoeditSessionOptions): Promise<CoeditSession> {
  const key = cacheKey(opts.matterId, opts.docId);

  // 1. Already resolved — return it.
  const existing = clientCache.get(key);
  if (existing) return Promise.resolve(existing);

  // 2. Already building — share the promise.
  const pending = pendingCache.get(key);
  if (pending) return pending;

  // 3. Build it.
  const promise = _buildSession(opts).then(
    (session) => {
      pendingCache.delete(key);
      clientCache.set(key, session);
      return session;
    },
    (err: unknown) => {
      pendingCache.delete(key);
      throw err;
    },
  );
  pendingCache.set(key, promise);
  return promise;
}

/**
 * Stop and remove the CoeditSession for a (matter, doc) pair. Idempotent.
 * This is the module-level teardown; `session.close()` delegates here.
 */
export function closeCoeditSession(matterId: string, docId: string): void {
  const key = cacheKey(matterId, docId);
  pendingCache.delete(key);
  const session = clientCache.get(key);
  if (!session) return;
  // Avoid recursive close() call — remove from cache first, then stop transport.
  clientCache.delete(key);
  // Stop the underlying sync client (the session object holds the reference).
  (session as CoeditSessionImpl)._stopTransport();
}

// ---------------------------------------------------------------------------
// Internal construction
// ---------------------------------------------------------------------------

async function _buildSession(opts: CoeditSessionOptions): Promise<CoeditSession> {
  const doc = new Y.Doc();

  // Closure-based presence state so it can be wired into callbacks before the
  // CoeditSessionImpl is constructed. The onPresenceCount callback mutates these.
  let presenceCount = 0;
  const presenceListeners = new Set<(otherCount: number) => void>();

  // Build sync client options, omitting optional keys when undefined so that
  // exactOptionalPropertyTypes is satisfied.
  const callbacks: import('@/modules/firm/MatterSyncClient').MatterSyncCallbacks = {
    onPresenceCount: (count: number) => {
      presenceCount = count;
      const otherCount = Math.max(0, count - 1);
      for (const listener of presenceListeners) {
        listener(otherCount);
      }
    },
  };

  const syncOpts: import('@/modules/coedit/MatterDocSyncClient').MatterDocSyncOptions = {
    matterId:  opts.matterId,
    docId:     opts.docId,
    doc,
    keyB64:    opts.keyB64,
    keyEpoch:  opts.keyEpoch,
    seatToken: opts.seatToken,
    client:    opts.client,
    callbacks,
  };
  if (opts.accessToken !== undefined)     syncOpts.accessToken     = opts.accessToken;
  if (opts.socketFactory !== undefined)   syncOpts.socketFactory   = opts.socketFactory;
  if (opts.maxCatchupPages !== undefined) syncOpts.maxCatchupPages = opts.maxCatchupPages;

  const syncClient = new MatterDocSyncClient(syncOpts);

  // Catch up the relay's history for this (matter, docId); go live on WS.
  await syncClient.start();

  // ------------------------------------------------------------------
  // Join-or-seed decision (made AFTER catch-up so relay state is applied)
  // ------------------------------------------------------------------
  const body = doc.getArray<Y.Map<unknown>>('body');
  const relayHasState = body.length > 0;

  if (!relayHasState && opts.initialJson) {
    // Relay is empty — seed from initialJson inside one transaction.
    // We import the meta + body from initialJson directly into this doc
    // (rather than creating a new doc via documentJsonToYDoc) so that the
    // existing sync listeners fire and the seed bytes flow to the relay.
    _seedDocFromJson(doc, opts.initialJson, {
      matterId: opts.matterId,
      docId: opts.docId,
      fileName: opts.fileName,
    });
  }
  // else: relay had state — JOIN; do NOT seed over it.

  const session = new CoeditSessionImpl(
    doc,
    syncClient,
    opts.matterId,
    opts.docId,
    () => presenceCount,
    presenceListeners,
  );
  return session;
}

/**
 * Seed a Y.Doc from a DocumentJson snapshot inside ONE transaction.
 *
 * This mirrors the structure built by documentJsonToYDoc but operates on an
 * existing (already-started) Y.Doc so that the update listener wired by
 * MatterDocSyncClient fires and the seed flows to the relay.
 *
 * We inline the DocumentJson→Y.Doc logic here rather than calling
 * documentJsonToYDoc (which creates a fresh Y.Doc) so the existing doc
 * retains its listeners.
 */
function _seedDocFromJson(
  doc: Y.Doc,
  json: DocumentJson,
  meta: { matterId: string; docId: string; fileName: string },
): void {
  // Build the complete tree in ONE transaction so downstream listeners get a
  // single update blob (important for E2EE relay efficiency).
  const seedDoc = documentJsonToYDoc(json, {
    matterId: meta.matterId,
    docId: meta.docId,
    fileName: meta.fileName,
  });

  // Apply the seed doc's state as an update onto the live doc. This triggers
  // the update listener wired by MatterDocSyncClient exactly once.
  const update = Y.encodeStateAsUpdate(seedDoc);
  Y.applyUpdate(doc, update);
}

// ---------------------------------------------------------------------------
// CoeditSession implementation
// ---------------------------------------------------------------------------

class CoeditSessionImpl implements CoeditSession {
  readonly doc: Y.Doc;
  private readonly syncClient: MatterDocSyncClient;
  private readonly matterId: string;
  private readonly docId: string;
  /** Accessor into the closure-based presence count (total subscribers including self). */
  private readonly _getPresenceCount: () => number;
  /** Shared listener set (from _buildSession closure) for presence change notifications. */
  private readonly _presenceListeners: Set<(otherCount: number) => void>;

  constructor(
    doc: Y.Doc,
    syncClient: MatterDocSyncClient,
    matterId: string,
    docId: string,
    getPresenceCount: () => number,
    presenceListeners: Set<(otherCount: number) => void>,
  ) {
    this.doc = doc;
    this.syncClient = syncClient;
    this.matterId = matterId;
    this.docId = docId;
    this._getPresenceCount = getPresenceCount;
    this._presenceListeners = presenceListeners;
  }

  getDocumentJson(): DocumentJson {
    return yDocToDocumentJson(this.doc);
  }

  onChange(cb: () => void): () => void {
    const handler = () => { cb(); };
    this.doc.on('update', handler);
    return () => { this.doc.off('update', handler); };
  }

  getOtherEditorCount(): number {
    return Math.max(0, this._getPresenceCount() - 1);
  }

  onPresenceChange(cb: (otherCount: number) => void): () => void {
    this._presenceListeners.add(cb);
    return () => this._presenceListeners.delete(cb);
  }

  close(): void {
    closeCoeditSession(this.matterId, this.docId);
  }

  /** Internal: stop the transport. Called by closeCoeditSession to avoid recursion. */
  _stopTransport(): void {
    // Snapshot state as update before teardown (design §7, R4).
    // The snapshot is currently produced on demand via getDocumentJson(); the
    // Y.Doc state is preserved until GC so callers can serialize if needed.
    // A snapshot blob could be persisted here in the future (Task 10 autosave).
    this.syncClient.stop();
  }
}
