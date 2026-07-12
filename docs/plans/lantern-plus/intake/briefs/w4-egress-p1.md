# URGENT P1 egress fixes — intake data leaving to the AI provider

**Branch:** `lp/intake-w4-egress` (checked out for you off the current lp/intake tip).
**You are Codex.** Two scoped, high-priority fixes from a full egress audit. Build, test, commit. Do NOT push. Do NOT run notify-jameson or any notification command. TDD: failing test first.

Both fixes protect the privacy promise: client-secret material and raw client content must not silently leave to an AI provider.

## [P1] Fix 1 — the live intake URL (with its secret fragment) is sent to the AI provider
`src/features/intake/NudgeReviewModal.tsx` (~lines 73-85) passes the LIVE intake link — including the secret URL fragment (the `#...` that decrypts the client page) — into an AI-provider prompt (e.g. drafting a nudge message). That hands a usable client-page capability to the model/provider. That fragment must NEVER reach any model.
**Fix:**
- Never pass a fragment-bearing intake link to any provider prompt. Before any link is included in prompt text sent to a model, strip the fragment (everything from `#` onward) and use a neutral PLACEHOLDER (e.g. `https://<intake-host>/i/<intake-id>` with no fragment, or a literal placeholder like `[intake link]`). The real link is inserted into the FINAL message the advisor sends to the client, NOT into the model prompt.
- Audit the whole nudge-draft path for any other place the fragment or `linkSecret` could enter a prompt.
**Test:** assert that the string passed to the provider (the prompt) does NOT contain the fragment. Add a durable guard test: for the nudge-draft provider call, the prompt must not contain a `#`-fragment-bearing intake URL (reject any prompt whose intake URL has a fragment). If practical, make the guard general — scan the provider prompt for the link-fragment prefix and fail if present.

## [P1] Fix 2 — emailReplyClassifier sends raw client email to the provider; make AI OFF by default
`src/platform/intake/emailReplyClassifier.ts` sends up to ~8000 chars of RAW client email body to the AI provider. Deterministic local matching must be the default; the AI path must be OFF by default and only used when a firm explicitly opts in.
**Fix:**
- Deterministic local matching stays the DEFAULT and only path unless AI is explicitly enabled. The AI classification path must be gated behind an explicit per-firm setting (find how other per-firm settings are stored/read — e.g. firm settings / a firm-scoped preference; reuse that pattern, do not invent a new global). Default value = OFF.
- When the setting is OFF (default), NO raw email body is sent to any provider — the classifier uses only the deterministic local path. When ON, keep current behavior but ensure the disclosure copy (below) is present.
- Add plain, honest disclosure copy near the setting: what gets sent (the email text), to whom (the firm's configured AI provider), and that it is off by default. Light theme, tokens, client/household language, no em dashes.
**Test:** with the setting OFF (default), assert the classifier does NOT call `provider`/`structuredOutput` with the email body (deterministic path only); with the setting ON, the AI path runs. Keep existing emailReplyClassifier tests green (adjust for the new default if they assumed AI-on).

## Non-negotiables
Do NOT change unrelated behavior. Deterministic email matching remains the default and unchanged. `matter`/`matter_id` never renamed. Light theme, tokens, no em dashes, no time estimates. Do NOT touch Wave 4 document-extraction files or the sibling's OnboardingTab/useIntakeInboxSync.

## Verify (report exact pass/fail)
```
npx vitest run src/platform/intake src/features/intake
npx tsc --noEmit
node scripts/eslint-gate.mjs
npm run test:contracts
```

## Finish
Commit on `lp/intake-w4-egress` with a message containing `W4-EGRESS-P1-FRAGMENT-AND-AI-DEFAULT-OFF`. Do NOT push. Report exact check results and confirm the tree is clean.
