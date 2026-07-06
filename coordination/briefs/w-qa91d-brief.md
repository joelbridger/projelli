# Worker brief — QA-91d: admitted-state detection + never self-destruct after admission (layer 4, FINAL)

You are **cc-lantern-qa91d**, worktree **~/lp-qa91d**, branch **lp/qa91d-admitted** (off current origin/lantern-plus tip). Demo-critical, the LAST layer. You do NOT merge. SCOPED tests only; push --no-verify authorized.

## The bug (proven live — read coordination/qa-campaign/evidence/legion-qa91-retest3/REPORT.md on lp/legionverify-evidence @f2cd7621, 10 screenshots)
The 3-layer launcher fix WORKS: the Notice Card reached the lobby, was admitted, and was VISIBLE with readable text to a genuinely separate second participant — first time ever. Then ~28s after admission the injected runner's unrecognized-page counter fired (the ADMITTED/in-meeting page doesn't match the adapter's admitted detection — the layer-2 worker explicitly disclosed lobby/admitted selectors were "multi-signal best-effort, VERIFY-LIVE"), the supervisor treated it as failure, FORCE-CLOSED the card (tile vanished from the meeting), and the recorder widget told the presenter "couldn't join" — false.

## Two fixes, both required
1. **Ground the admitted-state detection in the REAL post-admission page.** Capture it from the server: chrome-cdp session A (signed-in) creates a Meet-now meeting as HOST; fresh-profile session B joins as an anonymous guest (use the /v2/ rewrite from meetingPlatform.ts to skip the launcher); host session A ADMITS the guest; then capture session B's in-meeting DOM (call controls bar, hangup button, roster, whatever is stable — inventory it like the previous captures; save evidence). Retarget `teamsAdapter.ts` admitted/in-meeting detection on that ground truth (stable attributes + fallbacks), fixture tests from the capture. Refresh lobby/denied detection too if the capture reaches them cheaply.
2. **Policy: admission is a one-way latch.** Once the runner has observed admitted (or any in-meeting signal), an unrecognized page must NEVER force-close the card or report failure — the card is physically in the meeting doing its job. Downgrade to a "state unknown, card presumed present" status on the phase channel; keep it alive until the meeting/recording ends normally. The recorder widget must not show "couldn't join" after an observed admission. Find the force-close in `supervisor.ts` (~:278 evidence rules area) + the unrecognized counter in `injectionScript.ts` and gate them on the latch.

## Method
TDD: fixture test (admitted page from your capture → detected); latch tests (admitted-then-unrecognized → no force-close, no failure report, phase shows unknown-presumed-present; never-admitted unrecognized → existing fast-fail STAYS). tsc + scoped vitest green.

## Done criteria (HARD)
Captured-DOM evidence + both fixes + tests, committed AND pushed. THEN print exactly: `WORKER-DONE: lp/qa91d-admitted` + 4-line summary.
