# Wave 4 Lane 1 — ONE batched fix round (adversarial review findings)

**Branch:** `lp/intake-w4-tier1` (your prior work is committed at HEAD in this worktree).
**You are Codex.** Fix ALL FOUR findings below in one round, add a test per fix, re-verify, commit. Do NOT push. TDD: add the failing test first where practical, then fix.

Context: the Tier-1 client-side document warning must (a) never let a wrong file slip past the check via timing, (b) never attach a stale/wrong classification to a different file, (c) actually warn on conflicting-signal documents, and (d) stay advisory (never a hard block) — the client can always proceed in ONE click.

## Findings to fix

### [P1] Warning can be bypassed before the async check finishes — `intake-page/src/App.tsx` (~817 save file, ~837 await read, ~774 disabled)
When a file is chosen, the code stores it and THEN awaits reading its text to classify. During that await, no classification exists yet, so "Save and continue" is enabled and a client can submit a known-wrong file before the warning is computed.
**Fix:** track a per-slot "checking" state. While ANY selected slot's Tier-1 check is in-flight, the check is not settled — do not allow final submission yet (show a brief "Checking your file..." state / disabled Save with a spinner). The moment the check settles, proceed to the normal state (ok/unknown → Save enabled; warn → show the two choices per the non-blocking rule below). The disabled window must be ONLY the in-flight check, not a persistent block.

### [P1] A stale async result can classify a newer file — `intake-page/src/App.tsx` (~837 await, ~838 write result)
The async text-read result is written to state without checking whether the same `File` is still selected in that slot. Rapidly changing files can leave a clean file marked wrong or a wrong file marked clean, and can attach false override metadata.
**Fix:** use a per-slot generation token (increment on every file change) OR capture and compare the exact `File` reference before accepting the async result — discard the result if the slot's file changed while reading. Recompute/clear the sibling-side result too (duplicate-side detection reads `siblingLicenseSide`, which must reflect the CURRENT sibling file, not a stale one). No warning/override may ever be derived from a file that is no longer selected.

### [P1] Dead-code conflict rule → silent no-warning — `src/platform/intake/documentDetectiveRules.ts` (~103, `observedKind`)
The `kinds.size === 1` branch is unreachable (each kind yields exactly one match entry, so `matches.length > 1` implies `kinds.size > 1`). Result: a document with BOTH `form 1040` and `gross pay` becomes `unknown`, so a tax return uploaded for a license slot silently avoids a warning.
**Fix:** implement an explicit precedence table applied when multiple kinds match, BEFORE the `unknown` fallback:
  - `ira_statement` beats `brokerage_statement`.
  - `tax_return` beats any generic finance kind (`pay_stub`, `bank_statement`, `brokerage_statement`, `ira_statement`, `credit_card_statement`).
  - `drivers_license` beats a finance kind when license text signals are strong (an ID card that also says "class"/"address" should classify as license, not something else).
  - If the remaining tie is between two kinds with no defined precedence, keep `unknown` (do not guess), but the tax-return and ira cases above must resolve.
Add a conflicting-signals unit test: text with `form 1040` + `gross pay` in a license item → `warn wrong_doc`, observed `tax_return`; ira+brokerage → observed `ira_statement`.
Keep this reusable: Lane 2 (advisor-side classifier) will import the observed-kind detection, so factor the observed-kind + precedence logic into a clearly named exported function (e.g. keep/rename it so `classifyObservedKind(text, filename)` is exportable) without breaking existing tests.

### [P2] Warning is blocking — `intake-page/src/App.tsx` (~774)
"Save and continue" is disabled whenever a warning is unacknowledged, forcing the client to click "Keep this file anyway" first. The non-negotiable is: **the warning is advisory and never a hard block — the client can always proceed in ONE click.**
**Fix / product rule (build to this exactly):** when a slot's check has SETTLED with a warning, the client sees the warning + two choices: "Choose a different file" and "Keep this file anyway". "Keep this file anyway" is always a single click and always lets the upload proceed with the SAME sealed submission (E2EE unchanged), recording the override in the manifest. Do NOT permanently disable Save; the ONLY moment submission is unavailable is the brief in-flight-check window (finding 1). Acknowledgment = the single keep-anyway click; that is the intended friction, not a block. (If the simplest correct implementation is that hitting Save on an unacknowledged warning surfaces the keep-anyway choice inline rather than a dead-disabled button, that is acceptable — the requirement is: always proceedable in one action, never a silent bypass.)

## Tests to add (the review noted the 23 existing tests don't cover the races)
Extend `intake-page/tests/intake-page.spec.ts` (Playwright) and/or `documentDetectiveRules.test.ts`:
1. Submitting while a slot's Tier-1 check is still in flight is not possible; once settled the correct state shows. (Simulate a slow read if needed, or assert the checking/disabled-then-enabled transition.)
2. Rapidly selecting file A then file B in the same slot never leaves B classified by A's result (assert the warning matches the final file).
3. "Keep this file anyway" always completes the upload in one click after a warning (already partly covered — assert Save is not permanently dead).
4. Conflicting-signals classification: `form 1040` + `gross pay` in a license item → `warn wrong_doc`, observed `tax_return`.

## Non-negotiables (unchanged)
Deterministic, no network/OCR/provider. Warning details only inside the sealed manifest — never in relay plaintext, resume/localStorage, logs, or a page-visible finalize flag (keep the existing privacy test green). Code chooses the item/slot/path, never file content. Light theme, tokens, client/household copy, no em dashes, no time estimates.

## Verify (report exact pass/fail)
```
npx vitest run tests/unit/intake/documentDetectiveRules.test.ts src/platform/intake
cd intake-page && npm run test ; cd ..
npx tsc --noEmit
node scripts/eslint-gate.mjs
```

## Finish
Commit on `lp/intake-w4-tier1` with a message containing the phrase `W4-LANE1-FIX-RACES-CONFLICT-NONBLOCK`. Do NOT push. Report exact check results and confirm the tree is clean. (The dispatcher detects completion by your process exiting — finish normally after committing.)
