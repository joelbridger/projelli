/**
 * retryWithBackoff — bounded retry for a boolean-signaling async operation.
 *
 * Extracted so an "await this and get a real success/failure answer" caller
 * (e.g. a terminal `.workflow` run-record write, where a false "it resolved"
 * gives false confidence about durability) can retry a few times for
 * transient hiccups (disk momentarily busy, a permission blip) without
 * either the caller or the operation needing to know about timers.
 *
 * `attempt` reports success via its own return value (`true`/`false`) rather
 * than throwing, so a network/FS error the operation already caught doesn't
 * need to be re-thrown just to be retried here.
 */
export async function retryWithBackoff(
  attempt: () => Promise<boolean>,
  delaysMs: number[] = [300, 600],
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<boolean> {
  let ok = await attempt();
  for (const delayMs of delaysMs) {
    if (ok) break;
    await sleep(delayMs);
    ok = await attempt();
  }
  return ok;
}
