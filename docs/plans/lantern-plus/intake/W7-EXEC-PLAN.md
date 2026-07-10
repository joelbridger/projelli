# Lantern Intake — Wave 7 Executable Plan (send a form to an existing client)

**Wave lead:** Opus 4.8 · high. **Branch:** `lp/intake-w7` (worktree `~/lp-intake-w7`), forked off the merged `lp/intake` tip `1d6944bc` (matter_id privacy fix + Wave 4 Lane 2 doc-core merged; Wave 4 Lane 3 extraction still building on its own branch — disjoint file territory from Wave 7, not a blocker).
**Spec:** `W7-PREP.md` (v2, all 10 adversarial findings already adopted — read it first) + `W7-PREP-REVIEW-FINDINGS.md` (raw findings) + `INTAKE-EGRESS-AUDIT.md` (privacy bar). **Briefs:** `briefs/w7-<n>-<slug>.md`, all four written up front during this prep pass (unlike Wave 3/4, where only Lane 1's brief was written before dispatch) — the coordinator asked for the full set before any lane is dispatched.

This plan does not change any W7-PREP decision. It grounds the plan against the actual code (a fresh `Explore` pass over every file every lane touches), corrects two drift points, resolves the six open questions, and states the dispatch order and gate plan the coordinator asked for.

---

## 0. Grounding corrections (code as of `1d6944bc`, not as W7-PREP's authors last saw it)

W7-PREP.md is accurate on every structural point. Two things drifted or were under-specified and would have broken a lane if copied verbatim:

1. **The `matter_id` "pre-wave privacy precondition" is already satisfied.** `createIntake.ts:54-61` sends exactly `{ intake_id, auth_token, expires_at, checklist_ciphertext_b64, state_ciphertext_b64, checklist_version }` — no `matter_id`. Traced to commit `27009146` (already merged, 3rd-most-recent touch to that file). The backend never defined a `matter_id` column or field either (`backend/src/lib/db.ts:307-321`, `backend/src/routes/intake.ts:95-144`). Lane 1 still owns a **regression test** proving this (per Adjudication P3.1 / audit ranked-fix #7) — it's a "stays true" test, not a "make it true" fix.
2. **`W7-PREP.md:167`'s example item id is wrong.** It shows `drivers-license` (hyphen). The real blueprint (`newHouseholdTemplate.ts:33`) and the routing alias table (`useIntakeInboxSync.ts:105`) both use `drivers_license` (underscore). Every brief below uses the underscore form. If a lane brief or Codex output introduces the hyphenated form anywhere, that's a bug — flag it in review.

Three more facts change scope for the better — not corrections to W7-PREP, just reasons Wave 7 is smaller than a wave with new backend/schema work usually is:

3. **No Rust and no backend changes anywhere in Wave 7.** Opaque relay item handles are not a new wire field — they're the existing `RequestItem.item_id` string, generated as a random opaque value instead of a semantic one, at checklist-build time. The relay and the client-page's chunk/submit routes already treat `item_id` as an opaque routing string; giving it a random value instead of `'ssn'` requires zero changes to `intake-page/src/relayClient.ts`, `intake-page/src/submission.ts`, or `backend/`. **No cargo compile happens this wave.** Drop the cargo-lock-claiming step from the gate ritual entirely — it doesn't apply.
4. **`intakeFactMatchList` cannot reuse `intakeFactList`.** `factsStore.ts:58-69` masks `display_value` only for `sensitivity === 'restricted'` (SSN, license). Every other kind — `income_annual`, `dob`, `beneficiary`, `employer`, `address`, `citizenship` — comes back as **full plaintext** in `display_value`. `intakeFactList` is not a value-free accessor; it is a masked-for-restricted-only accessor. `intakeFactMatchList` must be a genuinely new function that never reads or forwards `display_value` for any kind. This is P1.3 from the findings doc, confirmed still live in code.
5. **The persisted-store migration is currently a no-op.** `intakeStore.ts:162-167`'s `migratePersistedIntakeState` ignores `_version` and only sanitizes secrets. Bumping `version: 2` → `3` in the `persist` config (`intakeStore.ts:322`) does nothing by itself — Lane 1 must add real version-gated backfill logic inside that function, not just change the number.

---

## 1. The six open questions — RESOLVED

Taking W7-PREP §7's recommendations as-is; nothing in the grounding pass changes any of them.

| # | Question | Resolution |
|---|---|---|
| Q1 | Where do firm-saved blueprints live? | **Workspace-local, encrypted with existing app data.** No firm-wide sync this wave. |
| Q2 | May an advisor deliberately re-ask a known fact? | **No override in Wave 7.** Hide the mapped item as already on file; no reconfirmation feature. |
| Q3 | Default standing-request expiry? | **Reuse the existing 30-day lifecycle default**, existing extend/revoke controls. |
| Q4 | Rename the Onboarding tab now? | **Yes.** "Requests" is the durable client tab; "Onboarding" is its pinned, prominent filtered section. Old `setClientMapHubTab('onboarding')` call sites keep working via internal redirect. |
| Q5 | Firm-saved blueprints editable or copy-only? | **Built-ins immutable. Firm-saved: editable + archivable.** A sent request keeps its sealed snapshot forever regardless of later blueprint edits. |
| Q6 | Native question builder this wave? | **No.** Saved item sets built from the existing item catalog only. |

---

## 2. Lane structure and dispatch order

```
Lane 1 (core + safe routing)  ──merges──►  Lane 2 (blueprints + composer)  ──merges──►  Lane 3 (Requests board + tab)  ──merges──►  Lane 4 (cross-lane contract + fixtures)
```

**Strictly sequential, not fan-out.** Unlike Wave 4 (Lanes 1/2 ran in parallel), Wave 7's lanes each build on the previous lane's committed exports — Lane 2 needs Lane 1's `IntakeRecord`/descriptor/issuer surface; Lane 3 needs Lane 2's `RequestFromClientDialog` export and blueprint contract; Lane 4 needs all three product lanes merged to one clean tip. Do not dispatch a lane before its predecessor has merged into `lp/intake-w7` (or, once the coordinator gives the build go, into whatever the target integration branch is at that time).

**No parallelism, no cargo, no shared-file conflicts to arbitrate** — the file-territory table in `W7-PREP.md` §3 already keeps every lane's production files disjoint (Lane 2 and Lane 3 never touch the same file; Lane 4 touches no production file). This is the simplest wave in the program so far, gate-wise.

---

## 3. Wave gate plan

### Per-lane ritual (same discipline as Waves 3/4, minus the cargo step)

1. Brief already written (this prep pass). Dispatch Codex **prompt-from-file**, stdin closed, anchored sentinel `^DONE-EXIT:0$` under `Monitor`.
2. Lead diff review — read the security-relevant core closely: descriptor-based routing (never trust client-decrypted JSON for fact_kind/subject/format/MIME), request-folder slug validation, `assertSendableRequest` guard, ask-once accessor never leaking a value.
3. **One mandatory `codex-review --base lp/intake-w7`** (or the then-current integration branch) on the clean committed lane. Focus: cross-request routing (a standing submission satisfying an onboarding item or vice versa), fact/value leakage into React state or persisted blueprint JSON, request-folder traversal, accidental onboarding regressions, opaque-handle correctness (no semantic item id reaching a *new* standing request's sealed checklist).
4. **Batch all findings into one fix round** — no drip-feed review/fix cycles (standing rule, see `[[feedback-batch-findings-one-fix-round]]`).
5. Merge `--no-ff` into the integration branch. Fast gate: scoped `vitest` for the lane's new/changed test files + `npx tsc --noEmit` + `node scripts/eslint-gate.mjs` (use `npm run gate:changed`/`test:contracts` once the lane's changes are in if those commands exist on the tip being merged to — confirm before relying on them).
6. Push. Record `LANE-MERGED: <slug> <sha>` in this plan's status ledger (§5 below).

### Wave-end blocking commands (after Lane 4 merges)

```
npm run test:contracts
npx vitest run src/platform/intake/__tests__/standingRequestContract.test.ts src/features/intake/__tests__/RequestsBoard.test.tsx src/features/intake/__tests__/ClientRequestsTab.test.tsx
npm --prefix intake-page run typecheck
npm --prefix intake-page test
npm run gate
```

No cargo claim step — Wave 7 has no Rust changes. If `npm run gate` still runs Rust tests as part of its full sweep, that's fine to run uncontested (nothing else in this wave is compiling); only claim the box-wide lock if another lead's wave is mid-cargo-build at the same moment, per the existing box-wide courtesy rule.

### Bench requirement (coordinator-gated, do not run until released)

1. Open one client with an active onboarding request.
2. Create and send a standing request through the existing-client flow, from a saved blueprint, with at least one item that ask-once suppresses (client already has an active `income_annual` fact) and one that isn't suppressed.
3. Complete it on the Lantern client page.
4. Verify: the standing document lands in its own `Requests/<request-slug>/` folder; the answer appears only through the fact registry with correct `channel: 'intake_link'` provenance; both requests (onboarding + standing) show correct, independent board state; the suppressed item was never shown to the client.
5. Reopen the onboarding link and confirm its items, folder, and link state are byte-for-byte unchanged by the standing request's existence.

---

## 4. VERIFY register (Wave 7)

| # | Claim | How | When |
|---|---|---|---|
| V1 | No clear `matter_id` in any relay-create body (regression, already true) | Lane 1 wire-body assertion test | Lane 1 |
| V2 | Standing-item handles are opaque, code-generated, never semantic/catalog-derived | Lane 1 handle-generation test + Lane 4 relay-payload inspection | Lane 1 / Lane 4 |
| V3 | Receiver derives submission class/format/mapping/MIME/limits from the descriptor only, never from decrypted client JSON, for standing items | Lane 1 `useIntakeInboxSync` tests (JSON-for-upload, file-for-fact, wrong MIME, unknown handle, cross-request) | Lane 1 |
| V4 | Legacy onboarding routing behavior is byte-for-byte unchanged | Lane 1 regression run of existing `useIntakeInboxSync.test.ts` + `inboxSyncContract.test.ts` | Lane 1 |
| V5 | Version-2 persisted records rehydrate correctly to version 3 with backfilled `kind`/`requestSlug`/descriptors | Lane 1 real-fixture migration test | Lane 1 |
| V6 | `assertSendableRequest` blocks `pdf_fill`/`signature` regardless of caller; client page fails closed (no Skip) for unsupported actionable items | Lane 1 issuer + client-page tests | Lane 1 |
| V7 | `intakeFactMatchList` never returns a value, fact ID, provenance, or sensitivity — only `{subject, kind, status}` | Lane 2 accessor test + a grep-based assertion that the composer never imports `intakeFactList` | Lane 2 |
| V8 | Ask-once suppression only fires on an explicit `factMapping` match (subject + factKind), never a filename/label guess; a superseded fact does not suppress | Lane 2 `requestAskOnce.test.ts` | Lane 2 |
| V9 | Blueprint validation rejects `number`/`text`/`choice` guided formats (page doesn't render them) | Lane 2 `blueprintStore.test.ts` | Lane 2 |
| V10 | Standing-request email replies file under `Requests/<standing-slug>/email-replies/`, never fall back to `Requests/onboarding/` | Lane 1 email-filing tests | Lane 1 |
| V11 | Requests board shows both kinds; Onboarding filter shows only onboarding rows unchanged; client Requests tab isolates each request's link/received-items/nudge state | Lane 3 `RequestsBoard.test.tsx` + `ClientRequestsTab.test.tsx` | Lane 3 |
| V12 | Old `setClientMapHubTab('onboarding')` call sites still land the advisor on a populated view, not an empty one | Lane 3 legacy-redirect test | Lane 3 |
| V13 | Full encrypted round trip for a standing request (create → client submit → decrypt → file → fact write) uses real crypto, not mocked `IntakeRelayClient`/`IntakeSyncClient` | Lane 1 baseline contract test, extended by Lane 4 to the full 7-case matrix from `W7-PREP.md` §4 Lane 4 | Lane 1 / Lane 4 |
| V14 | One client can have an active onboarding request and a standing request simultaneously with zero cross-contamination of folders, links, or checklist state | Lane 4 cross-lane contract test, case 4 | Lane 4 |

---

## 5. Status ledger

- [ ] Grounding pass complete — this document.
- [ ] Lane 1 brief written — `briefs/w7-1-core.md`.
- [ ] Lane 2 brief written — `briefs/w7-2-composer.md`.
- [ ] Lane 3 brief written — `briefs/w7-3-requests-ui.md`.
- [ ] Lane 4 brief written — `briefs/w7-4-contracts.md`.
- [ ] Coordinator build go received.
- [ ] Lane 1 — MERGED `<sha>`
- [ ] Lane 2 — MERGED `<sha>`
- [ ] Lane 3 — MERGED `<sha>`
- [ ] Lane 4 — MERGED `<sha>`
- [ ] Wave-end full gate green
- [ ] Coordinator-gated synthetic standing-request bench
- [ ] `WORKER-DONE: lp/intake-w7`

---

## 6. Landmines carried forward from Waves 3/4 (still live)

- Anchor every monitor sentinel `^DONE-EXIT:[0-9]+$` — loose match false-fires on echoed brief prose. See `[[project-monitor-anchor-done-sentinel]]`.
- Codex prompt-FROM-FILE only, stdin closed — backticks/quotes inline get shell-executed and corrupt the prompt. See `[[project-codex-prompt-from-file]]`.
- Fresh `lp-*` worktrees need OCR wasm assets copied in or the pre-push hook fails on an unrelated ENOENT. See `[[project_lp_ocr_asset_gap]]`.
- `codex-review --base <branch>` takes no custom prompt (bare form); run it on a clean committed worktree.
- Batch all review findings into one fix round — never drip-feed. See `[[feedback-batch-findings-one-fix-round]]`.
- Legion bench stays coordinator-gated — do not bench or deploy until released.
