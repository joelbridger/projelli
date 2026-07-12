# Wave 7 Lane 2 — Combined Fix Round

**Branch:** `lp/intake-w7-composer` (same worktree as the original build, `/home/jameson/lp-w7-composer`). Your prior commit `550ed7bd feat(intake): W7-LANE2-COMPOSER blueprints and request dialog` is already there, plus a lead gate-fix commit on top of it for eslint baseline findings (i18n wiring for the dialog's copy, silent-failure annotations, a redundant-union-type fix). Work on top of what's there — do not start over, and do not revert the gate-fix commit.
**You are Codex, the builder.** Fix the findings below, run the checks, commit. Do NOT push. Do NOT merge. Do not send notifications or messages of any kind; never invoke `notify-jameson`.

## Context

Your build was reviewed with an independent adversarial `codex-review --base lp/intake-w7`. It found two real P2s in `RequestFromClientDialog.tsx`, both about the dialog sending something the advisor didn't actually mean to send. Fix both in one pass — batch findings, no drip-feed.

## Finding 1 (P2) — the dialog can send a request with zero items

`sendRequest`'s guard (`RequestFromClientDialog.tsx`, around line 138) is `if (!selectedBlueprint || !resolution || blockedItem || sending) return;` — it never checks whether `resolution.visibleItems` is actually non-empty. If the advisor removes every item in the editor, or if ask-once suppression happens to suppress every single item in the blueprint (a small blueprint entirely composed of items the client already has answers for), the Send button stays enabled and Lane 1's issuer will happily create a live, active standing request whose checklist has nothing in it. The client opens the link to a completed-looking page with nothing to do, and the advisor has a meaningless active request cluttering their board.

**Fix:** disable the Send button (and bail out of `sendRequest` itself, not just the button, since disabled state alone isn't a security boundary) when `resolution.visibleItems.length === 0`. Show the advisor a clear reason inline — you already have the "Nothing needs to be requested right now." copy (`intake.requestFromClient.nothingNeeded`) rendered in that exact state; reuse it as the reason send is blocked, or add a short adjacent line if that copy reads oddly next to a disabled button in your judgment. Add a test: a blueprint where every item gets suppressed by ask-once results in a disabled Send button and `issueRequest` is never called even if you try to trigger `sendRequest` directly.

## Finding 2 (P2) — a stale draft can overwrite what the advisor is actually looking at

`reviewRequest` (around line 124-135) captures `draftItems` in its closure, awaits `intakeFactMatchList(matterId)` (a real network/IPC round trip with no fixed timing), and only then calls `setResolution(resolveAskOnce(draftItems, matches))` using that captured — now potentially stale — `draftItems` value. If the advisor edits a label, removes an item, or goes back and picks a different blueprint while that lookup is still pending, the resolution that eventually lands reflects the OLD draft, not what's currently on screen. Worse, if the advisor closes the dialog and reopens it (which resets `draftItems`/`selectedBlueprint`/`step` back to a fresh empty draft per your existing `useEffect` on `open`) while an old lookup is still in flight, that stale callback can fire afterward and stomp the fresh draft with leftover state from the previous, already-abandoned request.

**Fix:** guard against this with a generation/request token — the standard pattern for "ignore a late-arriving async result if the world has moved on." A `useRef` counter that increments whenever the dialog reopens (in your existing `open` reset effect) or whenever the draft is meaningfully replaced (blueprint selection) works well: capture the current generation value before the `await`, and after it resolves, only call `setResolution`/`setStep` if the generation is still current; otherwise silently drop the stale result (don't show an error — the advisor moved on intentionally, this isn't a failure). Do NOT try to solve this by disabling the editor while the lookup is pending instead — that changes the interaction model this brief didn't ask for and isn't what codex-review's fix direction implies; the generation-guard approach is additive and doesn't change any happy-path behavior. Add a test: start `reviewRequest`, before its `intakeFactMatchList` promise resolves simulate the advisor changing the draft (or reopening the dialog), let the promise resolve, and assert the stale resolution never reaches state (the dialog's displayed review reflects the new draft, not the old one).

## Self-converge requirement

Fix both findings, then run every test in your original brief's acceptance list again plus the two new regression tests above, until everything passes. Do not stop on a red test.

## Checks to run (report exact pass/fail; every test invocation wrapped in a timeout)

```
timeout 300 npx vitest run src/features/intake/__tests__/RequestFromClientDialog.test.tsx src/platform/intake/blueprintStore.test.ts src/platform/intake/requestAskOnce.test.ts
timeout 300 npx vitest run src/platform/intake src/features/intake
timeout 120 npx tsc --noEmit
timeout 120 node scripts/eslint-gate.mjs
```

## Finish

Create a NEW commit on `lp/intake-w7-composer` with a conventional message containing the phrase `W7-LANE2-FIXROUND`. Do NOT push. Do NOT merge. Report exact check results and state the branch is clean.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if every check passed and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). Do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
