# Lantern Intake — Wave 1 Tracker

**Wave lead:** Opus 4.8 · high. **Branch:** `lp/intake` (worktree `~/lp-intake`), off `lp/ux-simplify-v1` `3939b96c`.
**Plan:** `W1-EXEC-PLAN.md`. **Briefs:** `briefs/w1-<lane>.md`.

## Lane status

| Lane | Slug | Worktree | Branch | Codex | Review | Adversarial | Merged SHA | Status |
|---|---|---|---|---|---|---|---|---|
| A | contracts-crypto | `~/lp-w1-A` | `lp/intake-w1-A` | DONE-EXIT:0 | PASS (lead read) | PASS + 3 hardenings folded | in `2942df73` | **MERGED** |
| B | relay | `~/lp-w1-B` | `lp/intake-w1-B` | DONE-EXIT:0 | PASS (lead read) | PASS + 3 findings fixed | in `e828148e` | **MERGED** |
| C | client-page | `~/lp-w1-C` | `lp/intake-w1-C` | DONE-EXIT:0 | PASS (lead read) | PASS + 6 findings fixed | in `f782a768` | **MERGED** |
| D | advisor-side | `~/lp-w1-D` | `lp/intake-w1-D` | DONE-EXIT:0 | PASS (lead read) | PASS + 4 fixed + C↔D pageSeal reconciled | in `9a6990d5` (+`c1209ead`) | **MERGED** |
| E | hosting | `~/lp-w1-Efix` | `lp/intake-w1-E(fix)` | DONE-EXIT:0 | PASS (lead read) | PASS, 4 findings + collision | infra in `b977b8cc`, fix pending | RECONCILE-MERGED; fix round running |

**Lane E state:** E's infra merged into `lp/intake` at `b977b8cc` (collision reconciled: kept C's real page, dropped E's placeholder `intake-page/src/{app.js,index.html}`, kept E's `infra/intake/*` + `tests/security/intake-hosting.test.ts` + package.json scripts). A Codex reconcile+fix round (`laneE-fix.log`, worktree `~/lp-w1-Efix` branch `lp/intake-w1-Efix`) is running to: repoint `build-static-bundle.mjs` at C's real `intake-page/dist` vite build (was raw `intake-page/src` placeholder); fix the 4 review findings (Caddy `log`-in-`handle`, `_releases` route ordering, 24h log retention, served-hash-must-match-build); and the C↔E same-origin reconcile (page Caddy reverse-proxies `/intake/*` → relay + CSP `connect-src 'self'` so C's relative URLs work). After it lands: verify (security vitest + intake-page build + deploy dry-run) → merge to lp/intake → FINAL full gate → push → docs merges → bench review → WORKER-DONE.

## Gate evidence (filled at each merge)

- **Lane A:** independent `npx vitest run src/platform/intake` → 25/25 passed; `tsc --noEmit` + `typecheck:tests` + `eslint src/platform/intake` clean. Adversarial pass: codex gpt-5.5 xhigh, `codex-review --base lp/intake` → 1 formal P2 (weak link secret) + 2 manifest-validation gaps, all folded (commit `cb9a9e95`). `npm run gate` on merged `lp/intake`: entire TS half GREEN (typecheck, typecheck:tests, brand, identity, i18n, vitest, eslint gate, handle/token guards all ✅); cargo skipped-with-reason for Lane A (pure TS, zero Rust).
- **Lane B (MERGED `e828148e`):** lead read PASS (uniform-410 decoy-hash constant-time ✓, HMAC-only token ✓, durable dedup `UNIQUE(intake_id,submission_id)`+immediate-txn ✓, chunk keyed `(intake,item,submission,idx)` ✓, caps+rate limits ✓, privacy-proof scans all tables ✓). Codex adversarial (gpt-5.5 xhigh) found **3 real findings I missed** — [P1] advisor actions were same-org not creator-scoped (coworker could ack/revoke), [P1] `/submit` bytes uncounted → unbounded-DB DoS, [P2] chunks accepted after finalize. **All 3 fixed + regression-tested** (commits `69ed3063`+`552bd166`). Full backend `bun test` → **211 pass / 0 fail**. (NOTE: the re-run review process kept live-probing and reset the worktree twice, wiping uncommitted edits — had to kill it and commit fast. codex-review can mutate the worktree during live probing; commit fixes immediately.)

## Lane C review (6 findings) — fix round dispatched
Codex adversarial (gpt-5.5) on Lane C: [P1] flaky resume Playwright test (reload races the save); [P2] resume next-step ignores `finalized_item_ids` (can jump back to a provided item); [P2] **accent CSS injection** — a non-color accent (`url(https://…)`) from the checklist flows into `--accent` used in `background` → third-party fetch, breaks no-third-party promise (validate to a safe color); [P2] partial SSN (≥4 digits) sealable (require exactly 9); [P2] amount `90,000`/`abc` → NaN → sealed as null but marked complete (parse/validate); [P2] upload `max_files` treated as exact-required + no `max_bytes`. Plus committed `dist/`+`test-results/` to gitignore. **Fix round dispatched to Codex** (`laneC-fix.log`); re-verify playwright+axe after.

## Lane E review (4 findings) — fix WITH the C↔E reconciliation at E-merge (E merges LAST)
Codex adversarial on Lane E: [P1] `log` directive inside a Caddy `handle` block fails `caddy validate` (move to site-level); [P1] `_releases/*` route shadowed by `try_files … /index.html` SPA fallback after first deploy (needs an ordered route before the fallback); [P2] relay access-log 24h retention not enforced (default rolling — keeps privacy-sensitive IP/UA/path metadata too long); [P2] `deploy-staging.mjs` doesn't assert the SERVED manifest version/bundleHash equals the just-built bundle (a cached prior release could pass the integrity gate). These all touch the same Caddy/deploy files as the **C↔E reconciliation** (drop E's placeholder `intake-page/src/{app.js,index.html}`, keep C's real SPA, same-origin reverse-proxy `/intake/*` → relay so C's relative URLs + `connect-src 'self'` work, repoint `build-static-bundle.mjs` at C's Vite `intake-page/dist`), so do them together when E merges after C.

## Lane D review — 5 findings (1 lead + 4 adversarial), fix round dispatched
Codex adversarial (gpt-5.5) found 4 (3 P1): [P1] `intakeStore` partialize persists the link (with the `#v1.<secret>` fragment) to localStorage → live bearer secret outside keychain; [P1] `IntakeSyncClient.syncOnce` advances the cursor past an UNACKED submission → transient filing failure silently loses a client submission (undercuts ack-last); [P1] `OnboardingTab` purge passes only `kind` and the Rust purge deletes every fact of that matter+kind → deleting one household member's SSN nukes both; [P2] `NewClientDialog` retry after link-creation failure creates a duplicate client. cargo store tests: 5/5 (`cargo test --lib intake`) ✓; vitest 32/32 ✓. **Fix round dispatched to Codex** (`laneD-fix.log`, 4 findings). The C↔D pageSeal AAD mismatch (below) the LEAD fixes at merge (not Codex — touches merged Lane C).
- Lead read: `IntakeSyncClient` ✓ (ack-LAST so a crash pre-write re-delivers; dedup by DECRYPTED manifest id; new_device/duplicate/integrity flags; uses Lane A `openManifest`/`verifySubmissionIntegrity`). Facts store `store.rs` ✓ (masking by sensitivity, `reveal_fact` writes an audit row and refuses on audit failure, `audit_append_failure_refuses_the_write` test, supersede chains). Independent vitest 32/32 ✓. cargo test + adversarial review running.
- **🔴 CRITICAL C↔D FINDING (lead catch — adversarial reviews D in isolation, won't see it):** Lane D `src/platform/intake/pageSeal.ts` seals the k_page checklist/state with GCM **AAD `'intake/page/blob/v1'`**, but merged Lane C `intake-page/src/pageCrypto.ts` uses **NO AAD**. AES-GCM with mismatched AAD fails auth → the client page CANNOT decrypt the bundle the advisor sealed → whole round-trip broken. **Fix at D-merge reconciliation:** unify BOTH onto ONE shared page-seal helper in `src/platform/intake` (promote pageSeal, delete C's pageCrypto, both import it), single canonical format. Batch with adversarial findings into one D fix round.

## Environment notes / known issues
- **Sidecar binaries gap (fixed in lp-intake + lp-w1-D):** fresh `lp-*` worktrees lack `src-tauri/binaries/*` (piper/espeak/ggml/llama — gitignored). Cargo build script fails `resource path binaries/piper-... doesn't exist`. Fix: `cp -a ~/lp-ux-integrate/src-tauri/binaries/. <worktree>/src-tauri/binaries/`. (Same class as the OCR-wasm gap.)
- **Baseline cargo flake (pre-existing, NOT intake):** `commands::mail::tests::backfill_marker_set_is_idempotent_and_clearable` fails under the parallel `cargo test --workspace` run (leaked marker state: `Some("1")` vs `None`) but **passes in isolation** (`--test-threads=1 --exact`). Treat as a known baseline flake; when Lane D's cargo runs, re-run this one in isolation if it appears — it is not a Lane D regression (Lane D adds new `commands::intake` tests).

## Cross-lane integration seams (VERIFY at D/E review + Legion bench)
- **C↔D page-seal format:** Lane C `intake-page/src/pageCrypto.ts` seals the k_page checklist/state as `[1B ver=1][12B IV][AES-GCM ct+tag]`, NO AAD, base64. Lane D (advisor mint + regenerate re-seal) MUST produce byte-identical output or the page can't decrypt the bundle. VERIFY at Lane D review; if they differ, unify into one shared helper (ideally promote to `src/platform/intake`). (Both currently duplicate the format — Lane A only shared the item-chunk seal, which has AAD; the page seal was not a Lane A export.)
- **C↔E same-origin relay:** Lane C `relayClient.ts` uses RELATIVE URLs (`/intake/...`) → same-origin only (correct, keeps CSP `connect-src 'self'`, no CORS). This REQUIRES Lane E to serve the page AND reverse-proxy `/intake/*` to the relay on the same origin. VERIFY at Lane E review (check `infra/intake/Caddyfile.intake-page-staging.snippet` + `headers.mjs`); if E deploys page + relay as separate origins without a proxy, the relative URLs break (reconcile: same-origin proxy, or configured relay base + CSP pin).
- **C↔E FILE COLLISION (must reconcile at merge):** Lane E created a placeholder shell `intake-page/src/{app.js,index.html,styles.css}` (it had no real page to deploy). It COLLIDES with Lane C's real SPA (`intake-page/src/styles.css` is a direct overlap; C uses `App.tsx`+`intake-page/index.html`). **Merge plan:** merge C first (real page); when merging E, DROP E's `intake-page/src/app.js` + `intake-page/src/index.html`, keep C's `styles.css`, keep ALL of E's `infra/intake/*` + `intake-page/deploy/README.md` + root `package.json` script + `tests/security/intake-hosting.test.ts`; then repoint E's `build-static-bundle.mjs`/`manifest.mjs`/`verify-served-bundle.mjs` at C's real Vite `intake-page/dist` output instead of the placeholder shell.
- **Lane C cleanliness:** committed `intake-page/dist/` and `intake-page/test-results/` (build output) — gitignore or `git rm` before/at merge.

## Pending sync (coordinator notes, 2026-07-10) — fold in at Wave 1 wrap (AFTER lanes merge)
- Pull `W2-PREP.md` + `docs/trust/it-pack/INTAKE-IT-PACK.md` from `lp/ux-simplify-v1` (`f9228650`).
- Merge docs branch `lp/docs-w7prep` (W7-PREP.md — schema-readiness verdict for Wave 7).
- Merge docs branch `lp/docs-w1bench` (W1-BENCH-RUNBOOK.md — the post-WORKER-DONE bench script). **REVIEW its "Hard Stops" section against this exec plan's gates before printing WORKER-DONE.**
- All docs-only, coordinator-reviewed, branched off lp/intake → clean merges.

## Wave 1 COMPLETE — all 5 lanes merged (2026-07-10)
All lanes merged into `lp/intake` with lead review + one codex adversarial pass each; every finding fixed + regression-tested; cross-lane seams reconciled:
- A contracts+crypto `2942df73` (+3 hardenings). B relay `e828148e` (+3 findings). C client-page `f782a768` (+6 findings). D advisor-side `9a6990d5` (+4 findings) + C↔D pageSeal AAD unified `c1209ead`. E hosting `b977b8cc`+`a639cd0e` (+4 findings, collision reconciled, C↔E same-origin proxy + `connect-src 'self'`). Architecture-boundary `matters->intake` edge declared `6ccfb900`.
- Docs folded in: W2-PREP, W7-PREP, W1-BENCH-RUNBOOK, INTAKE-IT-PACK (`21c63cf8`).
- **Bench runbook Hard Stops reviewed — fully compatible.** Its same-origin/`connect-src 'self'`/fragment-never-logged requirements match the C↔E reconciliation; the `intake:headers:test` / `intake:integrity:test` / `intake:fragment-check` scripts it expects all exist in package.json.
- Test evidence (independent, per lane): crypto vitest 25/25; backend bun 211; intake-page playwright+axe 13/13; advisor vitest 35/35 + cargo store 6/6; E security vitest 6/6. Final full `npm run gate` + backend `bun test` running before push + WORKER-DONE.

## Final full gate — RED on quality checks (fix round running), 2 confirmed flakes
First full `npm run gate` caught quality-gate regressions the SCOPED per-lane tests missed (all Lane D advisor UI):
- `typecheck:tests`: `tests/unit/matter/newClientDialog.test.tsx:140` tuple/undefined index error.
- `lint:gate`: 23 new ESLint findings in `src/features/intake/OnboardingTab.tsx` (+test) + `NewClientDialog.tsx` — `lantern-async/no-silent-failure` (void promises no `.catch`), `lantern-i18n/no-hardcoded-string` (6 user strings), no-confusing-void-expression / no-misused-promises / etc.
- `token-guard`: 12 hard-coded hex colors in `OnboardingTab.tsx` (provenance chips/badges) — must use design tokens.
**Fix round dispatched** (`laneQ-fix.log`, worktree `~/lp-w1-qfix`). After it lands: merge → re-run full gate.
**Two CONFIRMED resource flakes (pass in isolation, choke only under full-gate concurrency):** `tests/security/intake-hosting.test.ts` "signs the compiled Vite output" (`ERR_INSUFFICIENT_RESOURCES` — it spawns a real vite build inside vitest) → 6/6 in isolation; backend `bun test` → 211/0 in isolation. Treat as environmental; verify in isolation at final gate, don't block on them. (Follow-up: make that security test lighter / not run a full vite build under the concurrent gate.)

## Bench needs (for the Legion runner, AFTER WORKER-DONE)
- V6: complete all 5 items incl. camera uploads on a phone-sized browser against the staged relay; verify decrypt-and-file on desktop; screenshot.
- V7: real iOS Safari + Android Chrome camera capture.
- V9: intake keychain on real Windows (Credential Manager).
- V10: regenerate link mid-flow; old link dies; page works on new link.

## Log
- **2026-07-10:** Wave kicked off. Plan package (ARCHITECTURE/PRODUCT-DESIGN/WAVE-PLAN/RISKS/QUESTIONS + design brief) brought into `lp/intake` from `plan/intake-design` (surgical checkout, not full merge — that branch carried 9k lines of unrelated coordination churn). Verified all reuse-anchor files exist. Wrote `W1-EXEC-PLAN.md` + Lane A brief. Dispatching Lane A (contracts + crypto) alone first.
