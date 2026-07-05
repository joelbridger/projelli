// Whole-practice Ask, layer 3: the settle-time orchestration for a single
// submission — commit the result/error/loading state ONLY if the request is
// still the current one (a workspace/client switch or a newer submit makes it
// stale), and restore the typed question on failure so the advisor never has
// to retype it after the expected first-time consent block (BUG-002 pattern,
// matching normal Ask's error recovery). Pulled out of Ask.tsx so this async
// orchestration is directly unit-testable without rendering the component.
import type { BookAskResult } from './bookFacts';

export interface BookSubmissionHandlers {
  onResult: (result: BookAskResult & { model: string }) => void;
  onError: (message: string) => void;
  onSettle: () => void;
  /** Restores the composer's text after a failed send. */
  restoreQuestion: (question: string) => void;
  isStale: () => boolean;
}

export async function settleBookSubmission(
  pending: Promise<BookAskResult & { model: string }>,
  askedQuestion: string,
  handlers: BookSubmissionHandlers,
): Promise<void> {
  try {
    const result = await pending;
    if (!handlers.isStale()) handlers.onResult(result);
  } catch (e) {
    if (!handlers.isStale()) {
      handlers.onError(e instanceof Error ? e.message : String(e));
      handlers.restoreQuestion(askedQuestion);
    }
  } finally {
    if (!handlers.isStale()) handlers.onSettle();
  }
}
