/**
 * Hard timeout for the meeting-notes generation call.
 *
 * QA-31 — "Notes are being written…" was hanging forever after transcription
 * completed. Root cause: tryGenerateNotes (meetingStore.ts) awaited
 * meetingNoteFromTranscript.run() — a single, non-streaming
 * provider.sendMessage() call — with NO bound on how long it could take. When
 * that call never settled (a hung fetch, a stalled proxy, a local model stuck
 * loading), the await never returned, which meant stopRecording's outer
 * `finally` (the only place that decrements `processingCount`) never ran
 * either — the RecordPill's "writing your notes" spinner stayed up with no
 * error and no way out short of restarting the app.
 *
 * This is deliberately NOT the two-stage stall watchdog Ask's answer stage got
 * for the analogous bug (createAnswerStallWatchdog in askTimeout.ts): that
 * watchdog re-arms on every streamed token via `onChunk`, because a legitimately
 * long-but-progressing streamed answer must never be killed on total duration
 * alone. Meeting-notes generation has no such signal — sendMessage() here
 * returns one opaque promise with no incremental progress — so it is the same
 * shape as Ask's RETRIEVAL stage (withAskTimeout): one promise, one generous
 * total-duration bound. Unlike retrieval's "orphan and ignore" approach, the
 * Provider interface exposes an AbortSignal, so this timeout actually cancels
 * the in-flight request instead of leaving it to dangle.
 */

/**
 * Generation runs in the background after Stop (never blocking the advisor
 * synchronously the way an Ask answer does), and a full meeting transcript is
 * a much larger prompt than a typical chat turn, so this is deliberately more
 * generous than Ask's answer timeout (45s) — long enough that a legitimately
 * slow-but-working call essentially never trips it, short enough that a
 * genuine hang always resolves to an honest failure within about two minutes.
 */
export const MEETING_NOTES_TIMEOUT_MS = 120_000;

/** Thrown when meeting-notes generation exceeds `MEETING_NOTES_TIMEOUT_MS`. */
export class MeetingNotesTimeoutError extends Error {
  constructor(ms: number) {
    super(`Meeting notes generation timed out after ${String(ms)}ms`);
    this.name = 'MeetingNotesTimeoutError';
  }
}

/** True for a MeetingNotesTimeoutError, including one that crossed a
 *  serialization/bundle boundary (matched by name), so callers never rely on
 *  `instanceof` alone. */
export function isMeetingNotesTimeoutError(err: unknown): err is MeetingNotesTimeoutError {
  return (
    err instanceof MeetingNotesTimeoutError ||
    (err instanceof Error && err.name === 'MeetingNotesTimeoutError')
  );
}

/**
 * Runs `run` with an AbortSignal that fires after `ms` of no result. If `run`
 * has not settled by then, the signal is aborted (so the underlying fetch can
 * actually stop) and the race rejects with `MeetingNotesTimeoutError`.
 *
 * The timer is ALWAYS cleared in a `finally`, so a call that settles in time
 * never leaves a dangling timeout.
 */
export async function withMeetingNotesTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number = MEETING_NOTES_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // codex-review: reject BEFORE aborting. An abort-aware provider (e.g.
      // ClaudeProvider's fetch call, wired to this same signal) can reject
      // its own promise the moment `abort()` fires — if that happened first,
      // Promise.race below could settle on a generic AbortError instead of
      // this MeetingNotesTimeoutError, silently downgrading a persisted
      // notesError.kind from 'timeout' to 'error'. Settling this promise
      // first guarantees its rejection reaction is queued before any
      // abort-triggered one, so the timeout always wins the race.
      reject(new MeetingNotesTimeoutError(ms));
      controller.abort();
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
