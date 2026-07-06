# Worker brief — Notice-Card guest never knocks (~1/3 of joins) — INVESTIGATION first

You are **cc-lantern-noknock**, an investigation lane (code-first; NO bench access — the Legion is PINNED for Jameson's demo and the cloud bench is busy). Create worktree **~/lp-noknock** on new branch **lp/notice-noknock** off current `origin/lantern-plus` (`git -C ~/lantern-plus worktree add -b lp/notice-noknock ~/lp-noknock origin/lantern-plus`). You do NOT merge. SCOPED tests only. Read `coordination/WORKER-DISCIPLINE.md`.

## The symptom (Legion dry-run Take 2, Run 3; also seen ~1/3 across recent live tests)
In a real 2-person Teams meeting, the Recording Notice guest (the app's headless guest that joins the meeting lobby to display the consent notice card) **never knocked at all** — no lobby join attempt visible to the host; the app's recorder widget correctly fell back to "Notice card couldn't join. Say the notice aloud." Runs 1-2 the same day worked fully (card visible 5+ minutes to a real second participant). So: intermittent, roughly 1-in-3, total no-show (distinct from the already-fixed QA-91 layers: join detection, admission latch, post-admission self-destruct — read `coordination/qa-campaign/` QA-91 material + branches lp/qa91*).

## Job (investigation deliverable, fix only if root cause is clearly in our code and bounded)
1. Map the notice-guest join pipeline end-to-end (launch → navigate to meeting link → pre-lobby → knock). Where can it silently produce zero knock with no error surfaced beyond the generic fallback?
2. Hunt for: races on guest-browser launch/navigation timeouts, one-shot selectors on Teams' pre-join UI that legitimately vary (A/B'd DOM, cookie banners, "continue on browser" interstitials — see lp/qa91c-interstitial for prior art), swallowed exceptions, and missing retry (does a failed knock retry even once?).
3. Deliverable: a written root-cause hypothesis ranked by evidence in `coordination/reports/noknock-investigation.md` (on your branch), including the exact code path that produced "couldn't join" with no knock, what logging/telemetry is missing to prove it live, and a proposed bounded fix (e.g. one retry cycle + specific interstitial handling + diagnostic breadcrumbs).
4. If the fix is clearly bounded (<~2h): implement it TDD with the missing diagnostics included. Otherwise stop at the report — do not expand scope.

## Done criteria (HARD)
Report (+ fix if done) committed AND pushed (`git push --no-verify -u origin lp/notice-noknock`), verify with `git ls-remote`. THEN print exactly: `WORKER-DONE: lp/notice-noknock` + 3-line summary (top hypothesis, evidence strength, fixed or report-only).
