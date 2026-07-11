# Lantern Intake — Wave 7 Executable Plan (send a form to an existing client)

**Wave lead:** Opus 4.8 · high. **Branch:** `lp/intake-w7` (worktree `~/lp-intake-w7`), rebased onto `origin/lp/intake` at `71bee41c` (Waves 1-6 fully integrated, cross-wave-reviewed clean) on build-go.
**Spec:** `W7-PREP.md` (v2, all 10 adversarial findings already adopted — read it first) + `W7-PREP-REVIEW-FINDINGS.md` (raw findings) + `INTAKE-EGRESS-AUDIT.md` (privacy bar) + `CROSSWAVE-REVIEW-FINDINGS.md` + `INTAKE-FOUNDATION-SECURITY-SWEEP.md` (P1-1, folded in at build-go — see §0.6). **Briefs:** `briefs/w7-<n>-<slug>.md`, all four written up front during prep, revised once at build-go to fold in P1-1.

This plan does not change any W7-PREP product decision. It grounds the plan against the actual code, corrects drift, resolves the six open questions, and states the dispatch order and gate plan the coordinator asked for.

---

## 0. Grounding corrections and the build-go P1-1 fold-in

W7-PREP.md is accurate on every structural point. A few things drifted, were under-specified, or (one) needed to become a first-class fix once the coordinator flagged it at build-go:

1. **The `matter_id` "pre-wave privacy precondition" is already satisfied.** `createIntake.ts` sends exactly `{ intake_id, auth_token, expires_at, checklist_ciphertext_b64, state_ciphertext_b64, checklist_version }` — no `matter_id`. Traced to commit `27009146` (already merged). The backend never defined a `matter_id` column or field either. Lane 1 still owns a **regression test** proving this (per Adjudication P3.1 / audit ranked-fix #7) — it's a "stays true" test, not a "make it true" fix.
2. **`W7-PREP.md:167`'s example item id is wrong.** It shows `drivers-license` (hyphen). The real blueprint (`newHouseholdTemplate.ts`) and the routing alias table both use `drivers_license` (underscore). Every brief uses the underscore form.
3. **No Rust and no backend changes anywhere in Wave 7.** Opaque relay item handles are not a new wire field — they're the existing `RequestItem.item_id` string, generated as a random opaque value instead of a semantic one, at checklist-build time. Giving it a random value instead of `'ssn'` requires zero changes to `intake-page/src/relayClient.ts`, `intake-page/src/submission.ts`, or `backend/`. **No cargo compile happens this wave** — the cargo-lock-claiming step doesn't apply.
4. **`intakeFactMatchList` cannot reuse `intakeFactList`.** `factsStore.ts` masks `display_value` only for `sensitivity === 'restricted'` (SSN, license). Every other kind — `income_annual`, `dob`, `beneficiary`, `employer`, `address`, `citizenship` — comes back as **full plaintext**. `intakeFactMatchList` must be a genuinely new function that never reads or forwards `display_value` for any kind. This is P1.3 from the findings doc, confirmed still live in code.
5. **The persisted-store migration is currently a no-op.** `migratePersistedIntakeState` ignores `_version` and only sanitizes secrets. Bumping `version: 2` → `3` does nothing by itself — Lane 1 must add real version-gated backfill logic.

### 0.6 P1-1 (build-go instruction, folded into Lane 1) — the receiver trusts client-chosen fact_kind/subject

At build-go the coordinator flagged a triple-confirmed P1 (egress audit + `CROSSWAVE-REVIEW-FINDINGS.md` + `INTAKE-FOUNDATION-SECURITY-SWEEP.md` P1-1, all independent): `useIntakeInboxSync.ts` accepts `fact_kind`, `subject`, and `response_format` out of decrypted client JSON with alias-table fallbacks, rather than deriving them from the advisor's own saved request. This is broader than a standing-request-only concern — it's live today for onboarding too.

**The fix folds directly into Lane 1's existing work, and turns out simpler than W7-PREP's original design.** Re-grounding at build-go found `IntakeRecord.requestItems?: RequestItem[]` already exists (`intakeStore.ts:83`, "the advisor-side copy of the sealed checklist," added for phone walkthroughs, populated today only by `NewClientDialog.tsx`) and each `RequestItem` already carries its own `subject` (on `RequestItemBase`) and, for `typed_field`, its own `fact_kind`. There is no need for the separate `RequestItemDescriptor[]` structure W7-PREP §2 originally specced — that would have been a second copy of the same data with a drift risk. Instead:

- `requestItems` becomes reliably populated for every request (onboarding and standing) and reconstructed for legacy records during the version-3 migration.
- `GuidedQuestionRequestItem` gets an additive `fact_kind?: FactKind` field (W7-PREP §2 already called for this, for a different reason — ask-once; it turns out to be load-bearing for the routing fix too).
- `routeIntakeSubmission` resolves the matching item from `requestItems` by `item_id` and derives `fact_kind`/`subject`/`response_format`/submission-class/MIME-policy from **that item's own fields only** — never from the decrypted body — for every request, not just new standing ones.
- If the body also supplies a conflicting `fact_kind`/`subject`/`response_format`, that's an `integrity_mismatch`, not a value to silently ignore-and-proceed past: flag it, write no fact, leave unacked.

This changed §2 (the shared contract) and Lane 1's brief materially — see the revised `briefs/w7-1-core.md` for the full mechanism, and VERIFY V2/V3/V5/V15 below.

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
2. Lead diff review — read the security-relevant core closely: `requestItems`-based routing (never trust client-decrypted JSON for fact_kind/subject/format/MIME, for onboarding OR standing — this is the P1-1 fix, verify it wasn't scoped down to standing-only), the conflicting-body-field rejection path, request-folder slug validation, `assertSendableRequest` guard, ask-once accessor never leaking a value.
3. **One mandatory `codex-review --base lp/intake-w7`** (or the then-current integration branch) on the clean committed lane. Focus: cross-request routing (a standing submission satisfying an onboarding item or vice versa), a body-supplied `fact_kind`/`subject` that disagrees with `requestItems` being silently honored instead of rejected, fact/value leakage into React state or persisted blueprint JSON, request-folder traversal, accidental onboarding regressions, opaque-handle correctness (no semantic item id reaching a *new* standing request's sealed checklist).
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
| V2 | Standing-item `item_id` values are opaque, code-generated, never semantic/catalog-derived (fact_kind/subject still live directly on the item object, not on a separate structure) | Lane 1 handle-generation test + Lane 4 relay-payload inspection | Lane 1 / Lane 4 |
| V3 | Receiver derives submission class/format/subject/fact-kind/MIME/limits from `IntakeRecord.requestItems` (the item matched by `item_id`) only, never from decrypted client JSON — for EVERY request, onboarding included, not standing-only | Lane 1 `useIntakeInboxSync` tests (JSON-for-upload, file-for-fact, wrong MIME, unknown item_id, cross-request, plus a legacy-onboarding spoofed-body case) | Lane 1 |
| V4 | Legacy onboarding routing OUTCOME is byte-for-byte unchanged for legitimate submissions, even though the mechanism changed (receiver now reads `requestItems`, not the body, to decide) | Lane 1 regression run of existing `useIntakeInboxSync.test.ts` + `inboxSyncContract.test.ts` | Lane 1 |
| V5 | Version-2 persisted records rehydrate correctly to version 3 with backfilled `kind`/`requestSlug`/`requestItems` (reconstructed from `defaultNewHouseholdItems()` by item id, not the loose `PhoneWalkthrough.tsx` fallback) | Lane 1 real-fixture migration test | Lane 1 |
| V6 | `assertSendableRequest` blocks `pdf_fill`/`signature` regardless of caller; client page fails closed (no Skip) for unsupported actionable items | Lane 1 issuer + client-page tests | Lane 1 |
| V7 | `intakeFactMatchList` never returns a value, fact ID, provenance, or sensitivity — only `{subject, kind, status}` | Lane 2 accessor test + a grep-based assertion that the composer never imports `intakeFactList` | Lane 2 |
| V8 | Ask-once suppression only fires when an item's own `subject`+`fact_kind` fields match an active fact, never a filename/label guess; a superseded fact does not suppress | Lane 2 `requestAskOnce.test.ts` | Lane 2 |
| V15 | A submission whose decrypted body includes a `fact_kind`/`subject`/`response_format` that CONFLICTS with what the matched `requestItems` entry says is rejected (`integrity_mismatch`, no fact write, no ack) rather than silently resolved either way — the explicit coordinator-mandated P1-1 regression test | Lane 1 `useIntakeInboxSync.test.ts` | Lane 1 |
| V9 | Blueprint validation rejects `number`/`text`/`choice` guided formats (page doesn't render them) | Lane 2 `blueprintStore.test.ts` | Lane 2 |
| V10 | Standing-request email replies file under `Requests/<standing-slug>/email-replies/`, never fall back to `Requests/onboarding/` | Lane 1 email-filing tests | Lane 1 |
| V11 | Requests board shows both kinds; Onboarding filter shows only onboarding rows unchanged; client Requests tab isolates each request's link/received-items/nudge state | Lane 3 `RequestsBoard.test.tsx` + `ClientRequestsTab.test.tsx` | Lane 3 |
| V12 | Old `setClientMapHubTab('onboarding')` call sites still land the advisor on a populated view, not an empty one | Lane 3 legacy-redirect test | Lane 3 |
| V13 | Full encrypted round trip for a standing request (create → client submit → decrypt → file → fact write) uses real crypto, not mocked `IntakeRelayClient`/`IntakeSyncClient` | Lane 1 baseline contract test, extended by Lane 4 to the full 7-case matrix from `W7-PREP.md` §4 Lane 4 | Lane 1 / Lane 4 |
| V14 | One client can have an active onboarding request and a standing request simultaneously with zero cross-contamination of folders, links, or checklist state | Lane 4 cross-lane contract test, case 4 | Lane 4 |

---

## 5. Status ledger

- [x] Grounding pass complete — this document.
- [x] Lane 1 brief written — `briefs/w7-1-core.md`.
- [x] Lane 2 brief written — `briefs/w7-2-composer.md`.
- [x] Lane 3 brief written — `briefs/w7-3-requests-ui.md`.
- [x] Lane 4 brief written — `briefs/w7-4-contracts.md`.
- [x] Coordinator build go received.
- [x] **Lane 1 — MERGED `49358ccf`** (build `60f18b88`, fix round `24fff23e` for 2 P1 + 2 P2 findings from lead review + mandatory `codex-review`, gate-fix `b6906a2d` for 7 eslint baseline findings). `getIntakesForMatter`, `IntakeRecord.requestItems`/`kind`/`requestSlug`/`requestTitle`/`blueprintRef`, `assertSendableRequest`, `createRequestSlug`/`assertRequestSlug`/`createOpaqueItemHandle` (`requestIdentity.ts`), `deriveRequestRow`, `GuidedQuestionRequestItem.fact_kind?` all shipped. Scoped suite: 237/237 green, tsc clean, eslint-gate clean.
- [x] **Lane 2 — MERGED `2d3f6018`** (build `550ed7bd`, gate-fix `1068393c`, fix round `cd492a06` for 2 P2 findings from mandatory `codex-review` — empty-request send + async stale-draft race, gate-fix `fde350a8`). `RequestBlueprint`/`blueprintStore`/`blueprintValidation`/`defaultBlueprints`, `intakeFactMatchList` (genuinely value-free), `resolveAskOnce`, `RequestFromClientDialog` (props: `matterId, clientName, open, onOpenChange, issueRequest, blueprints?, onIssued?`) all shipped. Scoped suite: 251/251 green, tsc clean, eslint-gate clean.
- [x] **Lane 3 — MERGED `1d533692`** (build `b5ad51f7`, fix round `dcb27344` for 1 P1 found two ways — lead review + mandatory `codex-review` both independently caught the matter-wide email-reply/quarantine/document-extraction review panels going unreachable — plus 1 P2, dead Nudge button on standing rows). `RequestsBoard`/`RequestsBoardContainer` (generic, `filter: 'onboarding' | 'all'`), `ClientRequestsTab` (mounts Lane 2's dialog, pins active onboarding first, each request its own `OnboardingTab` instance), `OnboardingBoard`/`OnboardingBoardContainer` now thin onboarding-filtered compatibility wrappers, legacy `'onboarding'` tab id preserved (now renders Requests, always visible). Scoped suite: 320/320 green, tsc clean, eslint-gate clean.
- [x] **Lane 4 — MERGED `f7f5464c`** (build `04107d64`, gate-fix `e7d62562`; independent `codex-review` found no issues — clean). All 7 required cross-lane acceptance cases from `W7-PREP.md` §4 Lane 4 pass with real crypto end-to-end (no mocked `IntakeRelayClient`/`IntakeSyncClient`): opaque handles + no wire leakage, ask-once suppression precision, real routed fact/file, onboarding-untouched-by-standing isolation, all 9 rejection cases (cross-request/unknown/wrong-class/conflicting/over-limit) flagged and unacked, real `RequestsBoard`+`ClientRequestsTab` UI integration with per-request link-control isolation, full wire-payload leak inspection. No production files touched (test files + synthetic fixtures only, per this lane's mandate). Scoped suite: 326/326 green, tsc clean, eslint-gate clean.
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
