# crm-merge-clients fix2 self-check receipt

- Final code commit: `0fb1ce07660efd546dd2435a6b3b73490319a60d`
- Final code tree: `988313235a7f7a0bdc8f9f50318638ea26b9d797`
- Approved rebase base: `509f73525`
- Checked at: `2026-07-16T06:47:31Z`
- Overall: GREEN for every requested non-Cargo check

## Fresh final-code checks

Every result below was run after the final code commit above, without changing code afterward.

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS, unpiped exit 0 |
| `npm run typecheck:tests` | PASS, unpiped exit 0 |
| `npm run boundaries:check` | PASS, exit 0; no regression, 64 current baseline findings |
| Merge + architecture + English locale focused Vitest set | PASS, exit 0; 3 files, 13 tests |
| `node scripts/ui-system/handle-guard.mjs` | PASS, exit 0; no vanished permanent or new ambiguous handle |
| ESLint on every touched TypeScript/TSX file | PASS, exit 0; no output |
| `git diff --check` | PASS |
| Rust formatting/parser pass with direct `rustfmt --edition 2021` | PASS, exit 0 |

Cargo and Rust tests were **not run**, exactly as instructed. The standard machine receipt wrapper was also not run because its changed-code gate automatically invokes Cargo when Rust files changed. This is a plain, honest evidence receipt, not the wrapper's machine-generated receipt.

## Safety and permission status

- The feature flag remains off by default.
- The landed `@/features/crm-permissions` doorway is used only as a renderer read mirror, with its async enforcement state read from `ownClientsEnforcementActive()`.
- The renderer no longer sends an invented member identity.
- Native approval fails closed until a trusted native current-member identity exists.
- Native enablement also still requires durable `ownerMemberId` / `assignedMemberIds` labelling and backfill. Display fields such as `primaryAdvisor` are not used as substitutes.
- Passing renderer tests do not prove native authorization. The feature must remain dark until the native identity and durable record-labelling work lands and is independently proven.
- The local all-or-nothing SQL transaction and active-workspace lock credited by the prior reviewer were preserved.
- New dormant native tests cover exact approved/rejected reload snapshots, receipt presence/absence, embedded identity mismatch, non-empty source to empty survivor arrays, replay resurrection protection, and a concurrent workspace switch.

## Out-of-lane files in the complete lane diff

- `src-tauri/src/commands/crm/features/mod.rs` — required append-only discovery entry for the owned native merge module.
- `src-tauri/src/commands/crm/migrations/mod.rs` — required append-only discovery entry for the merge receipt migration.
- `src-tauri/src/commands/crm/migrations/v0004_merge_receipts.rs` — durable redacted receipt schema plus the tombstone trigger that prevents a stale shared-record replay from reviving a merged source.
- `src/features/crm-clients/recordRegistry.tsx` — the single sanctioned public merge-action append and the already-reviewed flag-off filter that prevents a phantom toolbar slot.
- `src/features/crm-clients/recordRegistry.test.tsx` — shared registry order/flag proof and the lint-only callback correction.
- `src/platform/flags/registry.ts` — explicitly required off-by-default `crm-merge-clients` flag append.
- `evidence/crm-merge-clients-fix2-self-check-0fb1ce076.md` — this required evidence-only receipt.

No other out-of-lane file is present in `509f73525..0fb1ce076`.

## Integrity attestations

- Fresh checks: `[attest: yes + 0fb1ce07660efd546dd2435a6b3b73490319a60d]`
- Scope: `[attest: yes | all exceptions listed above]`
- Guard integrity: `[attest: yes | no suppression, baseline, assertion, type, timeout, snapshot, manifest, or guard was weakened]`
- Contracts: `[attest: yes | public exports remain eligibility, review, approval request/result, and redacted receipt lookup only; renderer actor identity was removed]`
