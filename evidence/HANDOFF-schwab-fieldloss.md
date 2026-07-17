# Lane v1/w2-schwab-fieldloss-fix — FIX ROUND HANDOFF

**Lane:** v1/w2-schwab-fieldloss-fix
**Approved base:** 5d472f689950f26de6e7eb9f48ce71303c5a6964
**Original code:** 97121c2fc9b5
**Final code commit:** 94f90f54a963668d9b6c78ed6d1781339fbf920a
**Fresh receipt:** evidence/self-check-receipt-94f90f54a963.txt — overall GREEN
**Worktree:** /home/jameson/v1-w2-schwab-fieldloss-fix

## Cross-client leak fixed

`SchwabPrefillReview` now puts every client-derived value inside a React subtree keyed by
`household id + account type`. A genuine household or account-type switch destroys the
old subtree before the new context renders. That resets the complete context together:

- editable fields and confirmation state;
- masked private facts and the proposal derived from them;
- dirty-field tracking;
- private reveals;
- loading, saving, and error state;
- cached packet receipt.

Within one unchanged context, the existing dirty-field merge still preserves advisor
edits while async household/fact data refreshes untouched fields.

The facts loader also keeps the form in its loading state until the fetched facts have
actually been folded into the proposal and fields. If the new client's fact request
fails, the new client's CRM-only/empty fields and load error render; no old-client fact,
candidate, typed value, or receipt is available to that context.

## New adversarial coverage

The focused suite now includes:

1. A genuine client A → different-id client B switch while B's facts are delayed. It
   types two unique A values, seeds a unique A private fact, and asserts all three are
   absent immediately during B loading and after B's own facts render.
2. A genuine A → B switch where B's fact request rejects. It asserts B's error and
   B-only/empty fields render, with zero A-typed or A-fact content anywhere in text or
   form-control state.
3. An account-type context switch proving typed values and fact-loading state reset.

The original audit-stall test is unchanged, unskipped, and remains in the focused and
changed-gate paths.

## Determinism and checks

- Focused Schwab suite repeated 20 times after the final timing fix: **20/20 green**,
  **11/11 tests per run** (220 test cases).
- `npm run typecheck`: PASS, zero errors.
- `npm run typecheck:tests`: PASS, zero errors.
- `npm run boundaries:test`: PASS, 5/5.
- `npm run lint:gate`: PASS, no regression.
- Fresh machine receipt: GREEN. `gate:changed` passed 8,886 tests with 29 skipped;
  handle guard, architecture guard, English i18n snapshot, and focused 11/11 all PASS.

## Scope

UI-local only. No store, foundation, relay, schema, or other feature changed. The prior
receipt for `97121c2fc9b5` is removed because it was superseded by this fix-round code and
fresh receipt.
