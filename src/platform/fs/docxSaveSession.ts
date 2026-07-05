/**
 * docxSaveSession — a per-path save/retry state machine for the SOLO (non-
 * co-edit) `.docx` editing path that OUTLIVES a `DocxEditor` component's React
 * mount lifecycle.
 *
 * WHY THIS EXISTS (QA-34 residual race, cleanup batch 4 / task #24):
 * `DocxEditor` used to keep its in-memory document, dirty flag, and save-retry
 * timers in component-local refs/state. Switching tabs away from an open
 * `.docx` unmounts `DocxEditor`; switching back mounts a BRAND NEW instance
 * that re-reads the file from disk via `docx_open`. If the previous instance
 * was mid-retry on a FAILING save when the user switched away, that fresh
 * disk read could be missing content the old instance was still trying (and
 * had not yet managed) to persist — the retry loop and the not-yet-saved
 * in-memory document died with the unmounted component. The persistent-
 * failure warning + "Save a copy elsewhere" rescue hatch (QA-34) covered the
 * case where the user stays on the tab, but not this tab-switch race.
 *
 * THE FIX: move the document + save/retry/escalation state into a session
 * object keyed by file path, independent of any component. `DocxEditor`
 * becomes a VIEW over the current session for its `filePath`:
 *   - Opening a path reuses an EXISTING session (if a prior view unmounted
 *     while it was still dirty/failing) instead of re-reading disk, so the
 *     latest unsaved edits are never silently dropped.
 *   - The session's own `setTimeout`-based debounce/retry timers are plain
 *     JS timers, not tied to any component's mount state, so a failing save
 *     keeps retrying in the background even while its tab isn't the active
 *     one.
 *   - Registration with `docxSaveRegistry` (which the app's close/quit/
 *     switch-workspace guards read) is tied to the SESSION's lifetime, not
 *     to whichever `DocxEditor` instance happens to be mounted — so those
 *     guards see accurate state even between tab switches / remounts.
 *   - A session is only ever disposed when it is CLEAN (nothing left to
 *     lose) — either because a mounted view unmounted while clean, or a
 *     background retry with no view watching finally landed. A session the
 *     user explicitly chose to discard (via `closeDocxTabSafely`'s "close
 *     and lose changes") is force-disposed instead, so it doesn't keep
 *     retrying to write content the user asked to abandon.
 *
 * SCOPE: solo editing only. Live co-editing (`coedit` prop on `DocxEditor`)
 * already sources its document from the CRDT (`CoeditSession`), which the
 * parent keeps alive independently of this component — a remount there
 * recomputes a correct, complete document from the CRDT, so it has no
 * equivalent data-loss risk and does not use this module.
 */

import { docxOpen, docxSave } from '@/platform/utils/docx-commands';
import { writeCoordinator } from '@/platform/fs/writeCoordinator';
import { registerDocxSaver, updateDocxSaveState } from '@/platform/fs/docxSaveRegistry';
import type { DocumentJson } from '@/platform/types/docx';

const RETRY_BASE_MS = 750;
const RETRY_MAX_MS = 15000;
const ESCALATE_AFTER_FAILURES = 3;

export interface DocxSessionSnapshot {
  isDirty: boolean;
  isSaving: boolean;
  saveError: string | null;
  escalated: boolean;
  lastSavedAt: number | undefined;
}

interface AfterSaveInfo {
  filePath: string;
  author: 'user' | 'ai';
}

export interface DocxSessionHooks {
  onFirstEdit?: () => Promise<void> | void;
  onAfterSave?: (info: AfterSaveInfo) => Promise<void> | void;
}

export class DocxSession {
  doc: DocumentJson;
  isDirty = false;
  isSaving = false;
  saveError: string | null = null;
  escalated = false;
  lastSavedAt: number | undefined = undefined;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = RETRY_BASE_MS;
  private consecutiveFailures = 0;
  private saveSeq = 0;
  private pendingAuthor: 'user' | 'ai' = 'user';
  /**
   * QA-81 (P2): whether the CURRENT unsaved content includes a real, COMMITTED
   * edit (blur / accept / reject / redline / export / a leaving-checkpoint
   * flush) that must produce a version-history snapshot (`onAfterSave`) when it
   * lands. Snapshot-worthiness is a property of the dirty CONTENT, not of the
   * particular save call or timer that happens to flush it — a live-typing
   * shadow save (`persistLive`) can absorb a pending committed save's debounce,
   * or a live retry can end up writing a doc that has since become a committed
   * edit; in both cases the committed content still deserves its snapshot. So a
   * committed edit SETS this flag, `persistLive` leaves it untouched, and the
   * write that actually persists the current doc consumes it — the snapshot
   * rides with the content regardless of which timer wins. Reset only when the
   * doc that just landed is still current (mirrors the `isDirty` clear), so a
   * newer committed edit arriving mid-write keeps its own pending snapshot.
   */
  private pendingSnapshot = false;
  /**
   * QA-81 (P2): true when live-typed content has reached disk via a shadow save
   * (`persistLive`) that did NOT take a version snapshot, and no committed save
   * has snapshotted it since. A leaving checkpoint (tab-switch / path-change /
   * close / quit) reads this to promote that finished edit into version history
   * — otherwise, because a shadow save already mirrored the text into
   * `this.doc` (so the outgoing-teardown's fold sees no diff and the session
   * looks "clean"), the edit would be disposed without ever being snapshotted.
   * Set/cleared by `attemptSave` (debt incurred by a snapshot-free write,
   * cleared by a snapshot); consumed by `ensureLeavingSnapshot`.
   */
  private liveSaveNeedsSnapshot = false;
  private onFirstEditFired = false;
  private unregister: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  /**
   * Set by the currently-mounted `DocxEditor` view (if any) so an external
   * flush (registry / close / quit) commits an in-progress, un-blurred
   * keystroke and drains the accept/reject/redline op queue BEFORE reading
   * the doc — exactly like the pre-session flush did. `null` when no view is
   * attached (a background retry): there is nothing left to commit/drain in
   * that case, so `flush()` just saves the session's own latest doc.
   */
  private liveFlushHook: (() => Promise<void>) | null = null;

  constructor(
    public readonly filePath: string,
    initialDoc: DocumentJson,
    private hooks: DocxSessionHooks,
  ) {
    this.doc = initialDoc;
    this.unregister = registerDocxSaver(
      filePath,
      () => this.flush(),
      () => { this.disposeForce(); },
    );
  }

  /** Point the session's hooks at the CURRENTLY mounted view (its refs are fresh per mount). */
  setHooks(hooks: DocxSessionHooks): void {
    this.hooks = hooks;
  }

  setLiveFlushHook(hook: (() => Promise<void>) | null): void {
    this.liveFlushHook = hook;
  }

  /**
   * Clear the live flush hook ONLY if `hook` is still the CURRENT one —
   * i.e. no NEWER view has replaced it since the caller set it.
   *
   * Why this exists: a session can be REUSED — a view unmounts while dirty/
   * failing (or, rarer, while it still has a queued op in flight), the
   * session survives, and a later remount of the SAME path picks up this
   * SAME session object and installs its OWN live flush hook. If the FIRST
   * view's teardown is delayed (e.g. waiting on that queued op to settle)
   * and only runs AFTER the second view has already attached, blindly
   * nulling the hook here would strip the SECOND view's hook instead of the
   * first's — so a later close/quit on the second view would never fold in
   * its own focused, un-blurred edit before saving (silent loss of the very
   * last keystrokes). Returns `false` when a newer view has already taken
   * over, so the caller knows NOT to proceed with dispose either (see
   * `disposeIfClean` — the same reused-session hazard applies to actually
   * tearing the session down while someone else still owns it).
   */
  clearLiveFlushHookIfCurrent(hook: (() => Promise<void>) | null): boolean {
    if (this.liveFlushHook !== hook) return false;
    this.liveFlushHook = null;
    return true;
  }

  setPendingAuthor(author: 'user' | 'ai'): void {
    this.pendingAuthor = author;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  getSnapshot(): DocxSessionSnapshot {
    return {
      isDirty: this.isDirty,
      isSaving: this.isSaving,
      saveError: this.saveError,
      escalated: this.escalated,
      lastSavedAt: this.lastSavedAt,
    };
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  private publishState(): void {
    // A disposed session must never touch the registry again: an in-flight
    // save/retry that was already running when this session got disposed
    // (e.g. a test/teardown force-disposing it, or a genuine discard) can
    // still settle asynchronously afterward. `updateDocxSaveState` looks up
    // by PATH only, so without this guard that late write could clobber a
    // DIFFERENT (newer) session's live state for the same path.
    if (this.disposed) return;
    updateDocxSaveState(this.filePath, {
      dirty: this.isDirty,
      saving: this.isSaving,
      error: this.saveError !== null,
    });
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  // Mirrors DocxEditor's original QA-34 backoff: retry the LATEST doc (the
  // user, or a background scheduleSave, may have moved on since the last
  // failure), so when the lock clears everything since is persisted. The
  // snapshot decision is NOT captured here: the retry re-reads `pendingSnapshot`
  // at save time, so if the user blurred (committing an edit) between the
  // failure and the retry, the retry correctly snapshots that committed edit —
  // and if it was pure live typing all along, it still doesn't (QA-81 P2).
  private scheduleRetry(): void {
    this.clearRetryTimer();
    if (this.disposed) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(delay * 2, RETRY_MAX_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.disposed) return;
      void this.persist(this.doc);
    }, delay);
  }

  private async attemptSave(doc: DocumentJson): Promise<boolean> {
    this.isSaving = true;
    this.notify();
    try {
      if (!this.onFirstEditFired) {
        this.onFirstEditFired = true;
        try {
          await this.hooks.onFirstEdit?.();
        } catch (err) {
          console.warn('[DocxSession] onFirstEdit failed:', err);
        }
      }
      const wasDirty = this.isDirty;
      // Capture snapshot-worthiness of the content being written NOW, before the
      // await — `doc` is the current dirty content at this point, and its
      // provenance (a committed edit set `pendingSnapshot`; a pure live-typing
      // shadow did not) is what decides whether this write feeds version
      // history. Reading it here (not from a per-call flag) is what makes the
      // snapshot ride with the CONTENT even when a live save/retry absorbs or
      // supersedes a committed save's timer (QA-81 P2).
      const wantSnapshot = this.pendingSnapshot;
      const rev = (this.saveSeq += 1);
      await writeCoordinator.enqueue(this.filePath, rev, () => docxSave(this.filePath, doc));
      this.lastSavedAt = Date.now();
      // Codex review catch: if a NEWER edit arrived (scheduleSave/persistNow
      // updated `this.doc`) while THIS save was still in flight, the doc we
      // just wrote is already stale — the current doc is genuinely still
      // unsaved. Only clear `isDirty` when the doc we just persisted is still
      // the current one; otherwise a quick tab-switch/close right after this
      // stale completion (and before the newer doc's own debounce fires)
      // could see a falsely-clean session and drop the newer edit entirely.
      // The pending snapshot is consumed on the same condition: a newer
      // committed edit that raced in keeps ITS own pending snapshot for its
      // own save.
      if (this.doc === doc) {
        this.isDirty = false;
        this.pendingSnapshot = false;
        // QA-81 (P2): track whether the content now on disk still owes a version
        // snapshot. A snapshot-free live shadow save (wasDirty, !wantSnapshot)
        // incurs the debt; a committed save (wantSnapshot) that takes the
        // snapshot below clears it. So a later leaving checkpoint can still
        // capture the finished edit even though this save already made the
        // session look "clean".
        this.liveSaveNeedsSnapshot = wasDirty && !wantSnapshot;
      }
      this.saveError = null;
      this.escalated = false;
      this.consecutiveFailures = 0;
      this.retryDelay = RETRY_BASE_MS;
      this.clearRetryTimer();
      const author = this.pendingAuthor;
      this.pendingAuthor = 'user';
      // Snapshot only when this write carried committed content (see
      // `pendingSnapshot`) — a pure live-typing shadow save does not flood the
      // version timeline, but a committed edit ALWAYS gets its snapshot even if
      // a live save/retry is what physically wrote it to disk.
      if (wasDirty && wantSnapshot) {
        try {
          await this.hooks.onAfterSave?.({ filePath: this.filePath, author });
        } catch (verr) {
          console.warn('[DocxSession] onAfterSave failed:', verr);
        }
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.saveError = message;
      this.isDirty = true;
      console.error('[DocxSession] save failed:', err);
      return false;
    } finally {
      this.isSaving = false;
      this.publishState();
      this.notify();
    }
  }

  /** One save attempt; on failure bumps the failure count, escalates after
   * enough consecutive failures, and schedules the next backoff retry. Whether
   * this write feeds version history is decided by `pendingSnapshot` (the
   * provenance of the current dirty content), not by the caller — see
   * `attemptSave`. A failed shadow save still retries with backoff exactly like
   * any other save, so nothing is lost. */
  async persist(doc: DocumentJson): Promise<boolean> {
    this.clearRetryTimer();
    const ok = await this.attemptSave(doc);
    if (ok) {
      // QA-43 (coordinator P0): this used to self-dispose here when nobody
      // was watching and the doc was clean — a "nothing left to keep alive
      // for" optimization. But disposal is IRREVERSIBLE identity loss: any
      // reference still held to this session (a caller mid-`scheduleSave`,
      // a stale closure) would keep calling into a disposed object whose
      // writes silently stop reaching the registry (`publishState` no-ops
      // once disposed — see below), reproducing exactly QA-43's symptom of a
      // SECOND failure cycle going silently untracked while the UI shows
      // "Saved". A session must only ever be disposed by an explicit
      // lifecycle event — a view's unmount/path-change cleanup (disposeIfClean)
      // or an explicit user discard (discardDocxSession) — never as a side
      // effect of a background save landing. The bounded cost: a session
      // that recovers while completely unwatched (nobody re-mounts its tab)
      // stays registered-but-clean until its tab is actually closed
      // (closeDocxTabSafely disposes it then) or the app quits.
      return true;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= ESCALATE_AFTER_FAILURES) this.escalated = true;
    this.publishState();
    this.notify();
    this.scheduleRetry();
    return false;
  }

  /** Update the in-memory doc and (re)schedule a debounced save of it. Called
   * for COMMITTED edits (blur / accept / reject / redline via
   * `applyResolvedDocument`), so it marks the content snapshot-worthy — that
   * intent then rides with the content even if a live shadow save or its retry
   * is what physically writes it first (QA-81 P2). */
  scheduleSave(doc: DocumentJson, debounceMs: number): void {
    this.doc = doc;
    this.isDirty = true;
    this.pendingSnapshot = true;
    this.publishState();
    this.notify();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.persist(doc);
    }, debounceMs);
  }

  /** Save `doc` immediately, bypassing any pending debounce (export / rescue-copy
   * flush) — a committed/meaningful save, so it too is snapshot-worthy. */
  async persistNow(doc: DocumentJson): Promise<boolean> {
    this.doc = doc;
    this.pendingSnapshot = true;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    return this.persist(doc);
  }

  /**
   * QA-81 (P0 data loss): the STEADY-STATE live-typing shadow save. The editor
   * calls this every ~2s while a run is focused so the un-blurred keystrokes
   * sitting in the contentEditable DOM reach disk on their own — not only when
   * the user navigates away. Differs from `persistNow` in two deliberate ways:
   *
   *  1. It marks the session DIRTY before queuing the write. `doc` is not on
   *     disk yet, and — critically for OVERLAPPING writes — if one docx_save
   *     runs longer than the 2s cadence, an OLDER write can complete while a
   *     NEWER shadow is still queued. `attemptSave` only clears isDirty when the
   *     doc it just wrote is still current, so marking dirty here means that
   *     older completion leaves the session dirty (newest text not yet saved)
   *     instead of publishing a false "clean"/"Saved" that a close/quit guard
   *     could act on and lose the newest keystrokes. Mirrors `scheduleSave`.
   *
   *  2. It does NOT itself mark the content snapshot-worthy — a snapshot every
   *     2s of active typing would flood the version timeline. It leaves
   *     `pendingSnapshot` UNTOUCHED: if a committed edit is already pending
   *     (e.g. this shadow save absorbed a blurred edit's debounce, or folded a
   *     committed run into `doc`), that committed content STILL snapshots when
   *     this write lands; if the only unsaved content is live typing, it
   *     doesn't. The eventual blur commit sets `pendingSnapshot`, so the
   *     finished edit is always captured.
   */
  async persistLive(doc: DocumentJson): Promise<boolean> {
    this.doc = doc;
    this.isDirty = true;
    this.publishState();
    this.notify();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    return this.persist(doc);
  }

  /**
   * QA-81 (P1): mark the session dirty the INSTANT the user types into a focused
   * run — do not wait for the periodic autosave's first tick to fold + save. A
   * keystroke lives only in the contentEditable DOM until then, so without this
   * the toolbar/registry read a false "Saved" while un-persisted text sits in
   * the DOM. This ONLY flips the dirty state (and publishes it); the actual disk
   * write is still done by `persistLive`. It does NOT mark the content
   * snapshot-worthy — live typing alone isn't (a blur commit is; see
   * `pendingSnapshot`). No-op when already dirty or disposed.
   */
  markDirty(): void {
    if (this.disposed || this.isDirty) return;
    this.isDirty = true;
    this.publishState();
    this.notify();
  }

  /**
   * QA-81 (P2): a leaving checkpoint (tab-switch / path-change / close / quit).
   * If live-typed content reached disk via a shadow save WITHOUT a version
   * snapshot (`liveSaveNeedsSnapshot`), promote it to a committed checkpoint —
   * mark dirty + snapshot-worthy — so the caller's final save records the
   * finished edit in version history instead of disposing a session that only
   * looks "clean" because the shadow already mirrored the text to disk.
   */
  ensureLeavingSnapshot(): void {
    if (this.disposed || !this.liveSaveNeedsSnapshot) return;
    this.isDirty = true;
    this.pendingSnapshot = true;
    this.publishState();
    this.notify();
  }

  /**
   * The registry-facing flush (close-tab / quit / workspace-switch guards).
   * Commits a live view's in-progress edit + drains its op queue first (when
   * a view is attached), then saves the latest doc if it isn't already clean.
   */
  private async flush(): Promise<boolean> {
    if (this.liveFlushHook) {
      try {
        await this.liveFlushHook();
      } catch (err) {
        console.error('[DocxSession] liveFlushHook failed:', err);
      }
    }
    // QA-81 (P2): if a shadow save already mirrored live-typed content to disk
    // without a snapshot, this leaving checkpoint must still record it in
    // version history (marks dirty + snapshot-worthy so the loop below persists
    // + snapshots it). Covers the no-view background flush where liveFlushHook
    // isn't present to commit the edit through the normal path.
    this.ensureLeavingSnapshot();
    // A close/switch/quit is a meaningful checkpoint: if any content is still
    // unsaved at this point — including purely live-typed text that never got a
    // blur commit (e.g. a background flush with no view to run liveFlushHook) —
    // it deserves a version-history snapshot, matching the pre-QA-81 flush which
    // always saved with a snapshot. (Ordinary committed edits already set this.)
    if (this.isDirty || this.saveError !== null) this.pendingSnapshot = true;
    // Loop while there's still something unresolved — either genuinely dirty
    // (a write can succeed yet be immediately stale if a newer edit lands
    // mid-flight, see attemptSave's staleness guard, e.g. the user types
    // right up to the moment they click close) OR already sitting in a
    // FAILED state from a prior attempt. That second case matters just as
    // much: a close/switch/quit flush called while the session is already
    // failing (e.g. mid-backoff after a transient file lock) must still try
    // again NOW rather than reporting failure purely because the LAST
    // attempt didn't work — the lock may have cleared since. The pre-session
    // registry flush always attempted one more save in this situation;
    // requiring `saveError === null` just to ENTER this loop silently
    // regressed that guarantee, letting a recoverable error masquerade as
    // permanent data loss. Bounded so a pathological continuous-edit stream
    // (or a lock that truly never clears) can't wedge a close/quit flush
    // forever — a caller here (closeDocxTabSafely, quit/switch flush) needs
    // an HONEST answer either way: is it actually safe to close/discard now.
    for (let attempt = 0; attempt < 3 && (this.isDirty || this.saveError !== null); attempt++) {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      await this.persist(this.doc);
    }
    return !this.isDirty && this.saveError === null;
  }

  /**
   * Dispose IF clean — nothing to lose, so it's safe to drop (a later open
   * reads fresh from disk). A dirty or failing session is intentionally left
   * alive: its retry timers keep running, so a later remount of the SAME
   * path resumes it instead of silently reloading stale disk content over an
   * unsaved edit (the QA-34 residual tab-switch race this module fixes).
   */
  disposeIfClean(): boolean {
    if (this.isDirty || this.isSaving || this.saveError !== null) return false;
    this.disposeForce();
    return true;
  }

  /**
   * True once this session has been force-disposed (an explicit discard —
   * see `discardDocxSession`). A mounted view must check this before acting
   * on a session it's holding a reference to: the registry-level discard can
   * happen out from under it (e.g. `closeDocxTabSafely`'s discard path runs
   * while the view is still mounted, and the view's own unmount cleanup runs
   * afterward) — without this check, that cleanup would resurrect a save
   * attempt on a session the user already asked to abandon.
   */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Force-stop this session regardless of dirty state (explicit user discard). */
  disposeForce(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.unregister?.();
    this.unregister = null;
    if (sessions.get(this.filePath) === this) sessions.delete(this.filePath);
  }
}

const sessions = new Map<string, DocxSession>();
const inflightOpens = new Map<string, Promise<DocxSession>>();

/**
 * Open (or resume) the solo-editing session for `filePath`. If a session
 * already exists — because a previous `DocxEditor` view unmounted while the
 * doc was still dirty/failing — its LIVE in-memory doc is returned instead of
 * re-reading disk, and its retry loop (which never stopped) keeps going.
 *
 * Deliberately does NOT special-case "the caller went away before this
 * resolved" by disposing the session: React 18 StrictMode's dev
 * setup→cleanup→setup double-invoke would otherwise race a still-loading
 * session out from under the SECOND (real) mount that's about to adopt it.
 * Disposal is owned entirely by the component's own unmount cleanup once it
 * has a chance to observe the final, settled state.
 */
export function openDocxSession(filePath: string, hooks: DocxSessionHooks): Promise<DocxSession> {
  const existing = sessions.get(filePath);
  if (existing) {
    existing.setHooks(hooks);
    return Promise.resolve(existing);
  }
  const inflight = inflightOpens.get(filePath);
  if (inflight) {
    return inflight.then((session) => {
      session.setHooks(hooks);
      return session;
    });
  }
  // A brand-new session for this path: clear any stale write-coordinator
  // high-water mark from a PREVIOUS session (see WriteCoordinator.resetPath).
  writeCoordinator.resetPath(filePath);
  const opened = docxOpen(filePath)
    .then((doc) => {
      inflightOpens.delete(filePath);
      const already = sessions.get(filePath);
      if (already) {
        already.setHooks(hooks);
        return already;
      }
      const session = new DocxSession(filePath, doc, hooks);
      sessions.set(filePath, session);
      return session;
    })
    .catch((err: unknown) => {
      inflightOpens.delete(filePath);
      throw err;
    });
  inflightOpens.set(filePath, opened);
  return opened;
}

/** The live session for `path`, if one is currently open/resumed — undefined otherwise. */
export function getExistingDocxSession(filePath: string): DocxSession | undefined {
  return sessions.get(filePath);
}

/** Test-only: drop all sessions (force-disposed) so tests using the same path stay isolated. */
export function __resetDocxSaveSessions(): void {
  for (const session of [...sessions.values()]) session.disposeForce();
  sessions.clear();
  inflightOpens.clear();
}
