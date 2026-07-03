/**
 * Frontend defense-in-depth timeout for the OneDrive sync pipeline.
 *
 * bench pass-3 HIGH regression: clicking "Sync now" produced total silence —
 * no spinner, no error, no audit row — because `runSync()`'s awaited Tauri
 * commands (`onedrive_list_folders`, `onedrive_sync`) had no bound: a stall
 * anywhere in the chain (auth refresh, a slow/large folder tree, ambient
 * resource pressure) left the frontend `await` hanging forever with no way to
 * recover except killing the app. The Rust commands now carry their own
 * deadline (LIST_FOLDERS_TIMEOUT / SYNC_TIMEOUT in
 * `src-tauri/src/commands/onedrive/commands.rs`), but `runSync()` also races
 * each call against this standalone client-side cutoff — so the UI's
 * settle-guarantee ("every sync attempt ends in a spinner->report/error, plus
 * an audit row") does not depend on the Rust side alone; a future change that
 * reintroduces a Rust-side hang, or a stall in the Tauri IPC bridge itself,
 * still can't wedge this button forever.
 */

/**
 * MUST stay strictly larger than the matching Rust command-level deadline
 * (`LIST_FOLDERS_TIMEOUT` / `SYNC_TIMEOUT` in
 * `src-tauri/src/commands/onedrive/commands.rs`), with real headroom — this
 * is a backstop for a stall the RUST SIDE CAN'T bound itself (a stuck Tauri
 * IPC bridge, a renderer-side hang), not the primary timeout. If this fired
 * before the Rust deadline, a slow-but-genuinely-working sync would get
 * reported to the user as a false failure (audited as one too) while the
 * backend kept running in the background — re-enabling the button lets the
 * user fire a SECOND sync that Rust then rejects as "already in progress",
 * compounding the confusion. Keeping this above the Rust side means it can
 * only ever fire for something Rust itself has no way to detect.
 */
export const ONEDRIVE_LIST_FOLDERS_TIMEOUT_MS = 200_000; // Rust: 180s + 20s headroom
export const ONEDRIVE_SYNC_TIMEOUT_MS = 32 * 60_000; // Rust: 30min + 2min headroom

/** Thrown when a OneDrive sync-pipeline step exceeds its timeout above. */
export class OneDriveTimeoutError extends Error {
  constructor(stage: string, ms: number) {
    super(`OneDrive ${stage} timed out after ${String(ms)}ms`);
    this.name = 'OneDriveTimeoutError';
  }
}

/**
 * Race `promise` against a hard timeout. If it does not settle within `ms`,
 * reject with `OneDriveTimeoutError(stage)` — `runSync()`'s existing catch
 * turns that into the same honest on-screen message + audit row as any other
 * sync failure. The timer is always cleared, so a promise that settles in
 * time never leaves a dangling timer.
 *
 * The stalled underlying call is not aborted (Tauri's `invoke()` offers no
 * cancellation): it is simply orphaned client-side once this rejects. That is
 * safe here only because `ms` is kept above the matching Rust command-level
 * deadline (see the constants above) — the Rust side always reaches its own
 * terminal state (report or timeout error) before this backstop could ever
 * fire during genuine, working operation.
 */
export async function withOneDriveTimeout<T>(
  promise: Promise<T>,
  stage: string,
  ms: number
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new OneDriveTimeoutError(stage, ms));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
