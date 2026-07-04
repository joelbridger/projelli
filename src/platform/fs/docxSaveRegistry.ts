/**
 * docxSaveRegistry — makes the `.docx` editor's REAL save state visible to the
 * app's save-integrity guards (QA-34, P0 silent data loss).
 *
 * Why this exists: a `.docx` is edited by `DocxEditor`, which keeps its OWN
 * dirty/saving/error state and persists directly to disk via `docx_save` — it
 * does NOT push content or a dirty flag into the editor store. So every
 * store-driven guard that decides "is there unsaved work here?" — the tab
 * dirty-dot, the close-tab confirmation, the workspace-switch guard, and the
 * quit/flush-all path — sees a `.docx` tab as permanently CLEAN, even while its
 * writes are failing. That is exactly how a failed save could show "Saved" and
 * let the user close/quit and lose everything with no warning.
 *
 * This tiny registry is the bridge: `DocxEditor` reports its live save state
 * here (keyed by file path) and registers a `flush` that forces one immediate
 * save attempt of the LATEST document. The guards consult `isDocxUnsaved(path)`
 * / `hasAnyUnsavedDocx()` and call `flushDocx(path)` before discarding a tab or
 * switching away, so the truth about a `.docx`'s unsaved/failing state can never
 * be silently contradicted by the rest of the UI.
 *
 * It holds NO document content — only booleans + a callback — so it never
 * duplicates or races the real save path; it just mirrors it.
 */

export interface DocxSaveState {
  /** The in-memory document differs from disk (a save is pending or failing). */
  dirty: boolean;
  /** A write is in flight right now. */
  saving: boolean;
  /** The last write attempt failed and has not yet recovered. */
  error: boolean;
}

interface Entry {
  state: DocxSaveState;
  /**
   * Force one immediate save attempt of the editor's LATEST document.
   * Resolves `true` if the document is now safely on disk (or was already
   * clean), `false` if the write failed. Never rejects.
   */
  flush: () => Promise<boolean>;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
// Monotonic version bumped on every change — the stable snapshot value for
// `useSyncExternalStore` consumers (e.g. the tab strip's unsaved dot).
let version = 0;

function notify(): void {
  version += 1;
  for (const fn of listeners) fn();
}

/** Subscribe to any registry change (register/unregister/state update). */
export function subscribeDocxSaveRegistry(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Snapshot value for `useSyncExternalStore` — changes on every registry change. */
export function getDocxSaveVersion(): number {
  return version;
}

/**
 * Register a `.docx` editor for `path`. Returns an unregister fn the editor must
 * call on unmount. Re-registering the same path (e.g. a remount) replaces the
 * previous entry — last mount wins, which matches "the live editor owns it."
 */
export function registerDocxSaver(path: string, flush: () => Promise<boolean>): () => void {
  // PRESERVE any existing save state for this path. Re-registration can happen
  // WITHOUT an unmount (e.g. the editor's register effect re-runs because a
  // callback identity changed on a parent re-render). Resetting to "clean" here
  // would make a dirty/failing .docx briefly — or, if no state-sync effect fires
  // afterward, permanently — read as saved, defeating the whole guard. Keep the
  // prior state and only swap in the fresh flush closure.
  const prev = entries.get(path)?.state;
  entries.set(path, { state: prev ?? { dirty: false, saving: false, error: false }, flush });
  notify();
  return () => {
    // Only remove if we still own this slot (a newer mount may have replaced us).
    const cur = entries.get(path);
    if (cur && cur.flush === flush) {
      entries.delete(path);
      notify();
    }
  };
}

/** Update the live save state for `path` (no-op if not registered). */
export function updateDocxSaveState(path: string, state: DocxSaveState): void {
  const entry = entries.get(path);
  if (!entry) return;
  const prev = entry.state;
  if (prev.dirty === state.dirty && prev.saving === state.saving && prev.error === state.error) {
    return; // unchanged — don't churn listeners
  }
  entry.state = state;
  notify();
}

/** The live save state for `path`, or undefined if no `.docx` editor is registered there. */
export function getDocxSaveState(path: string): DocxSaveState | undefined {
  return entries.get(path)?.state;
}

/**
 * True if an open `.docx` editor is registered for `path`. Use this (not
 * `isDocxUnsaved`) to decide whether to route a close/flush through the `.docx`
 * saver: the registry's boolean state can lag a pending debounced edit, so the
 * flush itself is the authority on clean-vs-dirty — always call it for a
 * registered `.docx` and let it decide.
 */
export function isDocxRegistered(path: string): boolean {
  return entries.has(path);
}

/**
 * True when the `.docx` at `path` has work not yet safely on disk — it is dirty,
 * mid-save, or in a failed-save state. This is the truthful "unsaved?" signal the
 * close/switch/quit guards must respect for a `.docx` (the store's `isDirty`
 * never reflects it).
 */
export function isDocxUnsaved(path: string): boolean {
  const s = entries.get(path)?.state;
  return !!s && (s.dirty || s.saving || s.error);
}

/** True if ANY registered `.docx` currently has unsaved/failing work. */
export function hasAnyUnsavedDocx(): boolean {
  for (const { state } of entries.values()) {
    if (state.dirty || state.saving || state.error) return true;
  }
  return false;
}

/**
 * True if ANY registered `.docx` has a save that has actually FAILED and not yet
 * recovered. Used by the app-close guard to fire the browser's native "you have
 * unsaved changes" prompt synchronously (the async flush on `pagehide` can't be
 * awaited before teardown), so the user isn't silently torn down mid-failure.
 */
export function hasFailingDocxSave(): boolean {
  for (const { state } of entries.values()) {
    if (state.error) return true;
  }
  return false;
}

/** Names/paths of every registered `.docx` with unsaved/failing work. */
export function unsavedDocxPaths(): string[] {
  const out: string[] = [];
  for (const [path, { state }] of entries.entries()) {
    if (state.dirty || state.saving || state.error) out.push(path);
  }
  return out;
}

/**
 * Force an immediate save of the `.docx` at `path` (if registered) and report
 * whether it is now safely persisted. Returns `true` when there is no registered
 * editor (nothing to flush) or the flush succeeded; `false` when the write
 * failed. Never rejects.
 */
export async function flushDocx(path: string): Promise<boolean> {
  const entry = entries.get(path);
  if (!entry) return true;
  try {
    return await entry.flush();
  } catch {
    return false;
  }
}

/**
 * Flush every registered `.docx`. Returns the paths that could NOT be saved so a
 * caller (quit / workspace switch) can warn about exactly what is at risk. Never
 * rejects.
 */
export async function flushAllDocx(): Promise<string[]> {
  const targets = [...entries.entries()];
  const results = await Promise.all(
    targets.map(async ([path, entry]) => {
      try {
        return { path, ok: await entry.flush() };
      } catch {
        return { path, ok: false };
      }
    }),
  );
  return results.filter((r) => !r.ok).map((r) => r.path);
}

/**
 * QA-34: airtight close for a `.docx` tab. Unlike a store-dirty tab (whose
 * content can be captured and re-opened on a failed flush), a `.docx`'s edits
 * live only in its still-mounted editor — once the tab is removed the editor
 * unmounts and the in-memory doc is gone. So we must save BEFORE removing it:
 *
 *   1. If `path` isn't an open `.docx`, return `false` — the caller runs its
 *      normal (store-tab) close.
 *   2. Otherwise force a final save WHILE THE EDITOR IS STILL MOUNTED. On success
 *      close the tab. On failure (a locked file) DON'T silently drop the doc:
 *      ask the user, and only discard if they explicitly choose to.
 *
 * Returns `true` when it handled the close (a `.docx`), `false` otherwise.
 *
 * Lives here (platform/fs) — not in the app layer — so both the app-layer TabBar
 * strip and the feature-layer Documents tab strip can call it without crossing
 * the layer DAG. Takes `closeTab` + the confirm callback as params so it stays
 * free of store/UI dependencies.
 */
export async function closeDocxTabSafely(
  path: string,
  ops: {
    closeTab: (path: string, opts?: { discard?: boolean }) => void;
    /** Shown ONLY when the final save failed; resolve true to close and lose changes. */
    confirmDiscardOnFailure: () => Promise<boolean>;
  },
): Promise<boolean> {
  if (!isDocxRegistered(path)) return false;
  const saved = await flushDocx(path); // editor is still mounted during this await
  if (saved) {
    // We already saved — close with `discard` so the beforeTabClose hook doesn't
    // redundantly flush again.
    ops.closeTab(path, { discard: true });
    return true;
  }
  const discard = await ops.confirmDiscardOnFailure();
  if (discard) ops.closeTab(path, { discard: true });
  // else: keep the tab open — editor stays mounted, escalation banner + "Save a
  // copy elsewhere" remain available; nothing is lost.
  return true;
}

/** Test-only: clear all registrations. */
export function __resetDocxSaveRegistry(): void {
  entries.clear();
  listeners.clear();
}
