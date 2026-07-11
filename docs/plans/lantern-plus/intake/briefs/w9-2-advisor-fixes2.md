# Wave 9 Lane 2 — Second Fix Round (real ESLint-gate regressions in your own new code)

**Branch:** `lp/intake-w9-advisor` (same branch, same worktree at `/home/jameson/lp-w9-advisor`). Your prior two commits (`47fa8361`, `abffbbf0`) are good work — this is a second, small, targeted fix round for genuine `eslint-gate.mjs` findings your own new code introduces. It is unrelated to typecheck.

**You are Codex, the builder.** Fix the issues below, re-run every check, commit. Do NOT push. Do NOT merge. Do not send notifications; never invoke `notify-jameson`.

## What happened

An independent, fully-isolated `npm ci` + `node scripts/eslint-gate.mjs` run found 24 total findings. **10 of those are not yours** — they're inherited from Lane 1's code exactly as it stood when your branch was created; they've already been fixed directly on `lp/intake-w9` in a separate commit, and will disappear automatically the moment your branch merges (you never touched those files, so the merge will cleanly take the fixed version — do not fix them yourself, doing so would just create a merge conflict with no benefit). **The other 14 are genuinely yours** — real findings in files only you touched. Fix exactly those 14.

## Fixes required

### 1. `OnboardingTab.tsx` and `SendForSignatureDialog.tsx` — `react-refresh/only-export-components` (3 occurrences)

`OnboardingTab.tsx` and `SendForSignatureDialog.tsx` each export a non-component value/function alongside their component export (breaks Fast Refresh, per this repo's convention of one component per file). In `SendForSignatureDialog.tsx`, `signatureStatusLabel` is a plain function exported alongside the `SendForSignatureDialog` component — move it to its own small new file (e.g. `src/platform/docusignSigning/signatureStatusLabel.ts` or `src/features/intake/docusignSigning/signatureStatusLabel.ts`, your call on which layer it belongs to — it's pure display-label logic, so the platform layer is probably right) and import it from both `SendForSignatureDialog.tsx` and wherever `OnboardingTab.tsx` needs the same/similar label. Check what `OnboardingTab.tsx`'s own two flagged exports are (read the eslint output yourself by re-running the check below) and apply the same extraction pattern — move any non-component export out to a small sibling module.

### 2. Three hardcoded user-facing strings (`lantern-i18n/no-hardcoded-string`)

- `OnboardingTab.tsx`: `"Send for signature"` (the button label)
- `RequestsBoard.tsx`: `"Send for signature"` (likely the same button label reused, or a related string)
- `SendForSignatureDialog.tsx`: `"Send for signature"` (the dialog heading) and `"This sends the completed form and the signer's name and email directly to DocuSign."` (the explanation text)

Check how the rest of this codebase handles i18n for similar strings (`t('some.key')` via `react-i18next`, used elsewhere in `RequestsBoard.tsx`/`OnboardingTab.tsx` already — e.g. `t('intake.board.new-client')` in `RequestsBoard.tsx`). Add proper translation keys under a sensible namespace (something like `intake.signature.*`) and wire them through `t()`, matching the existing pattern exactly — do not just add `eslint-disable` comments for user-facing copy; that rule exists to keep the app translatable; strings the advisor reads are exactly what it's for. Update the English locale resource file(s) this project already has (find them the way the existing `t('intake.board.new-client')` key resolves) so the new keys actually render text, not raw keys.

### 3. `SendForSignatureDialog.tsx` — `lantern-async/no-silent-failure`

```tsx
<Button ... onClick={() => { void send(); }}>
```

`send` is `async` and can throw/reject, but its error path is already handled internally (the function itself has a `try/catch` that sets `error` state) — so this is a **genuine** best-effort void-call, not an actual silent failure. The cleanest fix matching the rule's own escape hatch: add `// eslint-disable-next-line lantern-async/no-silent-failure -- send() already catches and surfaces its own error via local state` directly above the `onClick` line, matching the pattern this rule's own error message describes. Do not restructure `send`'s error handling — it's already correct; this is purely about satisfying the linter's expectation that the exception is explicit.

### 4. `docusignAdapter.test.ts` — `require-await` (2), `no-unsafe-assignment` (4), `no-base-to-string` (1), `no-unsafe-argument` (1), `no-unsafe-member-access` (3)

- `require-await`: the two `async () => ({ accessToken: ..., ... })` capability-provider callbacks passed to `new DirectDocusignAdapter(...)` never use `await` inside their body. Since the real `DirectDocusignAdapter` constructor expects a function returning `Promise<...>`, don't just drop `async` (that would return a non-Promise) — return `Promise.resolve({...})` instead, or keep them as plain arrow functions returning the object literal directly if `DirectDocusignAdapter`'s real parameter type is `() => X | Promise<X>` (check its actual signature in `docusignAdapter.ts` first and match it exactly).
- The `no-unsafe-*`/`no-base-to-string` findings are all about accessing `.documents`/`.recipients`/`init.body` on a value TypeScript sees as `any` — almost certainly from `fetchMock.mock.calls[N][1]` or similar (a mocked fetch call's captured arguments, which `vi.fn()` types loosely). Give the captured call/body a proper local type before accessing its fields — e.g. parse `JSON.parse(init.body as string) as { documents?: unknown[]; recipients?: unknown }` (or a more precise interface matching the real envelope-creation request shape you're asserting against) instead of accessing properties directly off an untyped/`any` value. This is exactly the kind of test-quality issue worth fixing properly, not suppressing — a wrongly-typed test assertion can silently stop testing what it claims to test.

### 5. `signatureWorkflow.test.ts` — `require-await` (3)

Same root cause as #4: async arrow functions in this file's `vi.mock(...)` factories or callback args that never use `await`. Find each (re-run the check below to get exact line numbers) and either remove the unnecessary `async` (if the surrounding type only needs a plain return) or use `Promise.resolve(...)` when a real Promise return is required by the consuming type — same judgment call as #4, matching whatever the actual consumed function signature needs.

## After fixing: re-run every check

```
timeout 300 npx vitest run src/platform/docusignSigning src/features/intake/docusignSigning src/platform/intake/intakeFiling.test.ts src/platform/intake/intakeStore.test.ts
timeout 300 npx vitest run src/features/intake
timeout 180 npx tsc --noEmit
timeout 240 node scripts/eslint-gate.mjs
```

The `eslint-gate.mjs` run will still show the 10 pre-existing Lane-1-inherited findings — that is expected and fine; do not try to fix those, do not touch any file under `src/platform/intake/docusignSignature/`, `blueprintValidation.ts`, or the two Lane-1 test files those findings point to. Confirm in your report that the **only** remaining findings after your fix are exactly those same 10 (by fingerprint/file), and that all 14 findings under your own file territory (the files listed in sections 1-5 above) are gone.

## Finish

Commit on `lp/intake-w9-advisor` (a new commit, do not amend prior ones) with a conventional message containing `W9-LANE2-ADVISOR-FIXES-2`. Do NOT push. Do NOT merge. Report exact check results and confirm the branch is clean.

The very last line of your output — after everything else, on its own line — must read exactly `DONE-EXIT:0` if every one of your own 14 findings is resolved and all other checks pass, or `DONE-EXIT:1` if something is unresolved (explain above that line). Do not print this sentinel early, more than once, or inside quoted/example text.
