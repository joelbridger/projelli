# Worker brief — QA-91c: Notice Card stuck on the Teams "browser or app?" interstitial (layer 3)

You are **cc-lantern-qa91c**, worktree **~/lp-qa91c**, branch **lp/qa91c-interstitial** (off tip 781db953). Demo-critical, final known layer. You do NOT merge. SCOPED tests only; push --no-verify authorized.

## The bug (proven live with a screenshot of the exact stuck screen)
Evidence: lp/legionverify-evidence commit cca5e1a4 (read the report + screenshot). The notice-card guest's hidden window ALWAYS lands on Teams' launcher interstitial — "Join on the Teams app? / Continue on this browser" — because it runs a FRESH profile every time (no cookies/memory). It never answers, so it never reaches the prejoin screen the (now-correct) adapter handles. 3/3 identical. The previous DOM capture missed this because the capturing browser had dismissed the interstitial historically.

## Why previous layers are NOT in question
Layer 1 (WebView2 args crash) fixed+verified @4cafb72f. Layer 2 (prejoin selectors) rebuilt from real DOM @f7847f63 — correct for the prejoin, which the guest currently never reaches. Your fix is a PRE-STEP, not a rework.

## Method — capture the REAL interstitial first
1. Using the server's Chrome (chrome-cdp): create a live meeting via "Meet now" on teams.live.com in the signed-in session; then open the bare join URL in a **fresh-profile context** (new chrome-cdp session; if it inherits cookies and skips the interstitial, force it — e.g. an incognito-context target or a scratch --user-data-dir via the CDP Target API — the goal is a browser with NO teams.live.com cookies). Capture the interstitial's real DOM: the "Continue on this browser" control (id/data-tid/aria/text), the "Open Teams app" alternates, any cookie-banner that precedes it. Save excerpts as evidence in your worktree.
2. Extend the Teams adapter/injection runner: new phase `launcher` detected BEFORE prejoin; action = click the continue-in-browser control (grounded selectors + text-fallback); then normal prejoin flow proceeds. Also handle a cookie-consent banner if the capture shows one precedes the interstitial (dismiss/accept minimal).
3. detectPhase ordering: launcher must not be mistaken for loading (the current ~29s unrecognized give-up) — it should be recognized and acted on within seconds.
4. Fixture tests from your captured DOM: launcher → clicks continue → prejoin fixtures still pass; legacy fixtures unaffected.
5. tsc + scoped vitest green. The coordinator schedules the Legion live retest after merge.

## Done criteria (HARD)
Captured-interstitial evidence + fix + tests, committed AND pushed. THEN print exactly: `WORKER-DONE: lp/qa91c-interstitial` + 4-line summary.
