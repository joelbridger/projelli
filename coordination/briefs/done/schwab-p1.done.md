# Schwab Account Opening Phase 1 - Done

Branch: `feat/schwab-prefill`
Worktree: `/home/jameson/lp-schwab-prefill`
Commit pushed: `e802d32d` (`feat(accounts): add Schwab account prefill flow`)

## What shipped

- Added the new account-opening feature under `src/features/accounts/`.
- Added an account-application model for:
  - individual
  - joint
  - roth IRA
  - traditional IRA
  - rollover IRA
  - inherited IRA
  - living trust
  - custodial
- Added field maps by account type:
  - owner details
  - DOB
  - SSN
  - address
  - phone and email
  - funding source
  - beneficiaries
  - trustee details for trust accounts
  - minor and custodian details for custodial accounts
- Marked SSN fields as `redact-on-store`.
  - The mapper can hold SSN while the advisor is actively editing.
  - The storage/audit helper removes plaintext SSNs and keeps only a masked tail.
- Added TDD coverage for:
  - required fields per account type
  - client/household prefill
  - meeting-summary prefill
  - blank fields staying blank for advisor entry
  - advisor edits
  - SSN redaction before storage/audit
  - placeholder template selection
- Added a light-theme workflow UI:
  - pick one or more account types
  - review grouped, editable fields
  - require advisor review before delivery
  - generate a placeholder PDF
  - open the DocuSign delivery path, with an honest unavailable state until envelope creation exists
- Wired the flow into the Workflows home action as `New account`.
- Added client-scoped audit logging metadata for review and delivery actions.
- Added all visible UI text to `en.json` and updated the English key-count snapshot.

## Explicitly not built

- No real Schwab official PDF form field maps yet.
- No real Schwab PDF templates yet.
- No auto-submit to Schwab.
- No client signing without advisor review.
- No plaintext SSN persistence.
- No DocuSign envelope creation backend yet.
  - Existing DocuSign code supports connect/sync/list behavior, not create-envelope.
  - The UI is wired to the connector path and returns a clear "not available yet" message.

## Placeholder template note

This phase uses neutral placeholder account-application templates.
The field map stores template IDs like placeholder Schwab form slots, so the later real Schwab work should be a data/template swap, not a UI rewrite.

## What needs the real Schwab forms

- Official Schwab form names and form numbers for every supported account type.
- The exact PDF field names, or field coordinates if the official PDFs are not fillable.
- Required versus optional fields for each form.
- Conditional rules, such as extra IRA, inherited IRA, trust, custodial, and beneficiary sections.
- Signature and initial fields for each signer.
- Any required addenda for beneficiaries, trustees, custodians, or inherited IRA details.
- Schwab-specific delivery package rules.
- Final template IDs replacing the placeholder template IDs in the account field map.

## Files touched

12 files in the pushed commit.

## Checks

### TDD red check

Initial focused account test run failed before implementation because the new module did not exist yet:

```text
npx vitest run src/features/accounts/accountApplication.test.ts

FAIL  src/features/accounts/accountApplication.test.ts
Error: Failed to resolve import "./accountApplication"
```

### Required scoped checks

```text
npm run typecheck

> advisor-prep-hero@3.3.5 typecheck
> tsc --noEmit
```

```text
npx vitest run src/features/accounts/accountApplication.test.ts src/features/accounts/NewAccountFlow.test.tsx

RUN  v4.1.3 /home/jameson/lp-schwab-prefill

Test Files  2 passed (2)
Tests  10 passed (10)
Duration  1.17s
```

```text
node scripts/eslint-gate.mjs

PASS: No ESLint regression vs baseline. (45 fingerprint(s) cleaned up vs baseline)
```

### Extra text-key check

The pre-push hook caught the new `accounts` translation namespace, so I updated the expected text inventory and reran the focused checks:

```text
npx vitest run src/features/accounts/accountApplication.test.ts src/features/accounts/NewAccountFlow.test.tsx tests/unit/i18n/en-json-snapshot.test.ts

RUN  v4.1.3 /home/jameson/lp-schwab-prefill

Test Files  3 passed (3)
Tests  16 passed (16)
Duration  1.19s
```

### Push gate

The branch push also ran the repository pre-push fast gate:

```text
pre-push: fast gate (typecheck + unit tests)...

Test Files  747 passed | 1 skipped (748)
Tests  7117 passed | 6 skipped (7123)
Duration  102.07s

PASS: fast gate passed
To https://github.com/lanternplatform/lantern.git
 * [new branch]        feat/schwab-prefill -> feat/schwab-prefill
```

## Coordinator notes

- I restored ignored local OCR test assets from `/home/jameson/lantern-plus/public/ocr/` before the successful push because this worktree was missing them and the pre-push unit run needs them.
- The front-end CRM household type currently exposes only basic household fields, while the Rust CRM model has richer normalized contact fields. The account mapper supports those richer field names now; passing the full contact record through the UI can be a later wiring task.
- Meeting-summary prefill is best-effort from the active client's meeting files: `transcript.json` plus `notes.md` or `notes.txt` when present.
- Audit metadata intentionally records field IDs/statuses, not field values, so SSNs do not leak into the audit log.
