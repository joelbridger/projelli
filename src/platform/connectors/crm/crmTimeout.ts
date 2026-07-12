/**
 * Frontend defense-in-depth timeout for the Wealthbox connect/sync pipeline.
 *
 * Adversarial review finding: "Wealthbox connect/sync can look frozen" —
 * `WealthboxConnect.runSync()`'s first network call (`crmListHouseholds()`)
 * has no frontend bound. The Rust client retries a 429 up to `MAX_429_RETRIES`
 * times with exponential backoff capped at 64s per attempt
 * (`src-tauri/src/commands/crm/client.rs`), so a sustained rate limit can hold
 * that single `await` for minutes with zero on-screen feedback beyond the
 * static "Connecting..." label. This timeout gives that call a hard ceiling so
 * a genuinely stuck request always resolves into an honest error the user can
 * act on, mirroring the OneDrive connector's `withOneDriveTimeout` pattern
 * (`src/platform/connectors/onedrive/onedriveTimeout.ts`).
 */

/**
 * Generous relative to the worst-case backend retry budget (6 attempts, capped
 * at 64s backoff each) so a slow-but-genuinely-working household fetch is
 * never reported as a false failure.
 */
export const CRM_LIST_HOUSEHOLDS_TIMEOUT_MS = 90_000;

/**
 * A full CRM import can legitimately take longer than fetching its household
 * list, but it still needs a ceiling. This is deliberately longer than the
 * initial-list limit: Wealthbox accounts can have enough records for the
 * encrypted local indexing step to take several minutes. It prevents the UI
 * from waiting forever if the desktop command gets stuck after dispatch.
 */
export const CRM_SYNC_COMMAND_TIMEOUT_MS = 10 * 60_000;

/** Thrown when a CRM sync-pipeline step exceeds its timeout above. */
export class CrmTimeoutError extends Error {
  constructor(stage: string, ms: number) {
    super(`Wealthbox ${stage} timed out after ${String(ms)}ms`);
    this.name = 'CrmTimeoutError';
  }
}

/**
 * Thrown when the user clicks Stop while a step this gate covers is in
 * flight. Distinct from `CrmTimeoutError` (a stall) — this is an intentional
 * exit, so callers should treat it like OneDriveConnect treats its own
 * folder-discovery-phase cancel (a "stopped", not an error).
 */
export class CrmCancelledError extends Error {
  constructor(stage: string) {
    super(`Wealthbox ${stage} was cancelled`);
    this.name = 'CrmCancelledError';
  }
}

/**
 * A one-shot cancel gate for a step `crm_cancel_sync` CANNOT reach.
 *
 * `crm_cancel_sync` only sets a backend flag that `engine::backfill` polls
 * between households during `crm_sync_all` — it has no effect on
 * `crm_list_households`, which has no cancellation awareness at all (a single
 * paginated GET loop with no access to that flag). Tauri's `invoke()` itself
 * offers no cancellation (same constraint documented in
 * `onedriveTimeout.ts`), so a real "Stop" during that phase can only come
 * from the frontend giving up on the wait. `race()` lets the UI do exactly
 * that: as soon as `cancel()` fires, the awaited call rejects with
 * `CrmCancelledError` and the UI moves on immediately. The orphaned
 * `crmListHouseholds()` call keeps running server-side until it resolves or
 * hits `CRM_LIST_HOUSEHOLDS_TIMEOUT_MS` above — safe to abandon because
 * nothing further reads its result once this has fired.
 */
export function createCrmCancelGate(stage: string): {
  cancel: () => void;
  race: <T>(promise: Promise<T>) => Promise<T>;
} {
  let reject: ((err: Error) => void) | undefined;
  const cancelled = new Promise<never>((_resolve, rej) => {
    reject = rej;
  });
  return {
    cancel: () => { reject?.(new CrmCancelledError(stage)); },
    race: (promise) => Promise.race([promise, cancelled]),
  };
}

/**
 * Race `promise` against a hard timeout. If it does not settle within `ms`,
 * reject with `CrmTimeoutError(stage)`. The timer is always cleared, so a
 * promise that settles in time never leaves a dangling timer.
 */
export async function withCrmTimeout<T>(
  promise: Promise<T>,
  stage: string,
  ms: number
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new CrmTimeoutError(stage, ms));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
