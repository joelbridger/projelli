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

/** Thrown when a CRM sync-pipeline step exceeds its timeout above. */
export class CrmTimeoutError extends Error {
  constructor(stage: string, ms: number) {
    super(`Wealthbox ${stage} timed out after ${String(ms)}ms`);
    this.name = 'CrmTimeoutError';
  }
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
