/**
 * QA-32: on some environments (confirmed on a fresh Windows bench VM), the
 * native folder/file picker (`@tauri-apps/plugin-dialog`'s `open()`) never
 * appears at all and its promise never resolves OR rejects — forever. Root
 * cause, from reading the actual dependency chain (tauri-plugin-dialog →
 * `rfd::AsyncFileDialog`): on Windows, `rfd` spawns a dedicated OS thread that
 * calls `CoInitializeEx` and shows the modern Explorer-style Common Item
 * Dialog (`IFileOpenDialog`), which is COM/shell infrastructure — it depends
 * on the Windows Shell (explorer.exe / Desktop Experience) being present. A
 * fresh/stripped VM image missing that shell can make `IFileOpenDialog::Show`
 * block forever waiting for window messages a broken shell never delivers,
 * while the OLDER `SHBrowseForFolder`/`FolderBrowserDialog` API (which qa5
 * confirmed still opened instantly on the same VM) doesn't depend on it. This
 * is a plausible, VM-environment-specific trigger, not something this repo's
 * code can fix at the root — but the UX hole (an app that can silently hang
 * forever with zero escape) is real regardless of root cause, so every
 * dialog invocation on the workspace-open/import paths races against this
 * watchdog and falls back to a manual path-entry prompt.
 */

/** Generous on purpose: a REAL, working dialog can legitimately sit open for
 *  a while as the user browses — this must never rush a real user. It only
 *  exists to catch "the dialog never even appeared", not "the user is
 *  thinking". */
export const DIALOG_WATCHDOG_TIMEOUT_MS = 90_000;

export type DialogWatchdogResult<T> =
  | { timedOut: true }
  | { timedOut: false; value: T };

/**
 * Races a native dialog promise against `timeoutMs`.
 *
 * - Dialog resolves/rejects first → behaves exactly like the raw promise
 *   (resolves with `{ timedOut: false, value }`, or rejects with the
 *   original error) — no behavior change for the normal, healthy case.
 * - Neither happens within `timeoutMs` → resolves with `{ timedOut: true }`
 *   so the caller can fall back to a manual path entry. If the real dialog
 *   eventually does settle after that, its result is simply discarded (the
 *   caller has already moved on).
 */
export function raceDialogWithWatchdog<T>(
  dialogPromise: Promise<T>,
  timeoutMs: number = DIALOG_WATCHDOG_TIMEOUT_MS,
): Promise<DialogWatchdogResult<T>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ timedOut: true });
    }, timeoutMs);
    dialogPromise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ timedOut: false, value });
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- passes the dialog's original rejection reason through unchanged, matching the raw promise's own behavior.
        reject(err);
      },
    );
  });
}
