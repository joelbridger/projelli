# Lantern Intake — Waves 5 & 6 Executable Plan (combined lead)

**Lead:** Intake W5+W6 session (Opus 4.8 · high), 2026-07-10. **Branch:** `lp/intake-w56` off `lp/intake` (@ `bf6fbc77` at dispatch). Lane worktrees `lp/w56-<slug>` off `lp/intake-w56`.
**Read alongside:** `WAVE-PLAN.md` (W5+W6 goals), `PRODUCT-DESIGN.md` (§5 phone mode, §6 client flow, §8 phone+nudges, welcome/what-happens-next P7), `ARCHITECTURE.md` (§2 key model, §3 relay, §9/§9a facts+prefill, §8 threat model — esp. T3/T4/T9), `docs/trust/it-pack/INTAKE-IT-PACK.md`, welcome-journey `CONTENT-PACK.md` (on `lp/ux-simplify-v1`, commit `f54643b7`).

> This is the MASTER house pattern from Waves 1–3 applied to two independent wave-sets run concurrently. **Build = Codex lanes** (own worktree, prompt-from-file, DONE-EXIT sentinel, liveness-watched). **Review = this lead** (diff read) **+ one adversarial `codex-review` per lane** (the pass that caught the deepest bug on every prior lane — never skipped). Batch all findings into ONE fix round per lane ([[feedback-batch-findings-one-fix-round]]). Merge `--no-ff` into `lp/intake-w56`, gate per merge, `LANE-MERGED` per lane. Full `npm run gate` before `WORKER-DONE: lp/intake-w56`.

---

## Non-negotiables (inherit from W3-EXEC-PLAN §1 + WAVE-PLAN global constraints)

- **E2EE bar is absolute for the link/key machinery.** W5c (key sharing/escrow) is the deepest-review lane: any path where the relay could read content, a wrong member could unwrap, or an ex-member keeps access past their epoch = STOP and escalate, do not ship.
- AI proposes → advisor approves. The MODEL never chooses client/request/item/path/recipient — CODE does.
- Intent audit BEFORE effect, outcome after; intent-fail refuses the write (`audit_pair_id` machinery).
- Restricted values (SSN, DL data): SQLCipher-only, masked UI, audited reveal — never in ordinary state or audit rows or resume state.
- `matter`/`matter_id` never renamed (facade). User-facing copy = client/household. Light theme, design tokens, no em dashes, no time estimates.
- **Privacy-proof standing gate stays green** (no plaintext client-submitted values / file names / client names in the page request/storage surface; no `restricted` fact ships outbound to the page).
- **Page-integrity (T3):** intake-page work keeps the self-contained, no-third-party, no-CDN, no-analytics rule and the CSP pinned to the relay origin; deploy-time signed-bundle-hash check stays intact.

## Gate flow (this session)

Fast gates (`test:contracts`, `gate-changed.sh`, `seed-cargo-lane.sh`) live on `lp/ux-simplify-v1`; the W4 lead is folding mainline into `lp/intake`. **Sync `lp/intake-w56` from `lp/intake` before the FIRST lane merge**, then use them if present. Until then / as the proven fallback:
- Per lane during build: scoped `npx vitest run <lane paths>` + `npx tsc --noEmit` + `node scripts/eslint-gate.mjs` (or `npm run lint:gate`).
- Per merge into `lp/intake-w56`: **full `npm run gate`** (typecheck + i18n completeness + vitest + ESLint + cargo). Serialize cargo box-wide (coordinate with the W4 lead via COORDINATOR: lines). Backend lanes also run `cd backend && bun test`.
- Known baseline flake: `commands::mail::tests::backfill_marker_set_is_idempotent_and_clearable` (passes in isolation under `--test-threads=1`; not intake).
- Legion BENCH is coordinator-gated — do NOT deploy/bench until released.

## Worktree setup (per lane)

```
git -C /home/jameson/lp-intake-w56 worktree add -b lp/w56-<slug> /home/jameson/lp-w56-<slug> lp/intake-w56
ln -s /home/jameson/lp-intake-w56/node_modules /home/jameson/lp-w56-<slug>/node_modules
# intake-page lanes also need:
ln -s /home/jameson/lp-ux-integrate/intake-page/node_modules /home/jameson/lp-w56-<slug>/intake-page/node_modules  # or npm --prefix intake-page ci
# Rust lane (W5c) also needs sidecar binaries + a warm/own cargo target:
cp -a /home/jameson/lp-ux-integrate/src-tauri/binaries/. /home/jameson/lp-w56-<slug>/src-tauri/binaries/
cp -a /home/jameson/lp-ux-integrate/public/ocr/. /home/jameson/lp-w56-<slug>/public/ocr/   # if pre-push ENOENT (project_lp_ocr_asset_gap)
export CARGO_TARGET_DIR=/home/jameson/.cargo-target-w56c   # per-lane; ONE cargo compile at a time box-wide
```

## Codex dispatch pattern (prompt-from-file, never inline)

```
PF=briefs/w56-<slug>.md ; WT=/home/jameson/lp-w56-<slug> ; LOG=<scratch>/w56-<slug>.log
nohup bash -c "codex exec --cd $WT --sandbox danger-full-access --skip-git-repo-check \"\$(cat $PF)\" < /dev/null >> $LOG 2>&1; echo DONE-EXIT:\$? >> $LOG" &
# watch: tail -f $LOG | grep --line-buffered -E '^DONE-EXIT:[0-9]+$' | sed -u '/^DONE-EXIT:[0-9]/q'
```
Anchor the sentinel filter `^DONE-EXIT:[0-9]+$` ([[project-monitor-anchor-done-sentinel]]). `codex-review --base lp/intake-w56` takes NO custom prompt; run it on a clean committed lane worktree.

---

## Lane roster (7 lanes)

### Wave 5 — phone mode · welcome journey · firm key sharing

| Lane | Slug | Stack | Primary files (scope) | Review focus |
|---|---|---|---|---|
| **W5a** | `phone-mode` | TS/React | `src/features/intake/PhoneWalkthrough*.tsx` (new), `OnboardingTab.tsx` (Start-walkthrough entry, supersede manual entry), `src/platform/intake/phoneWalkthrough*.ts` (new), reuse `factsStore.ts`/`intakeStore.ts`/`onboardingModel.ts` | provenance `phone_walkthrough` on every fact; interleave with link (one source of truth); restricted values still SQLCipher+audited; no plaintext in ordinary state |
| **W5b** | `welcome-journey` | TS/React + intake-page | advisor: `src/features/intake/WhatHappensNext*.tsx` (template editor, new) + wire into compose/finish; sealed into checklist; client: `intake-page/src/` completion/what-happens-next render | copy is from CONTENT-PACK.md (WIRE, don't rewrite); firm-authored steps/timeline/who's-who sealed under `k_page` (no relay-visible firm text); light theme, tokens, no em dashes |
| **W5c** | `key-sharing` | TS crypto + backend TS + a little Rust | `src/platform/intake/intakeKeyShare*.ts` (new sibling of `matterKeyService.ts`), `src/platform/firm/` reuse `keyWrap.ts`/`matterKeyService.ts`, `backend/src/routes/intake.ts` (share/escrow endpoints, mirror `matterKeys.ts`), Rust keychain unwrap in `src-tauri/src/commands/intake/`, escrow mirrors `vaultClient.ts` precedent | **DEEPEST.** wrong-member wrap must fail both directions; ex-member epoch semantics mirror `bumpMatterKeyEpoch`; org-admin escrow; relay only ever stores ciphertext-wrapped keys; two-advisor decrypt of one intake works; Firm-tier gating (intake ships all paid tiers, sharing/escrow = Firm-tier) |

### Wave 6 — analytics · hardening · IT pack · accessibility

| Lane | Slug | Stack | Primary files (scope) | Review focus |
|---|---|---|---|---|
| **W6a** | `kpi-strip` | TS/React | `src/platform/intake/onboardingKpis*.ts` (new, pure), `src/features/intake/OnboardingBoard*.tsx` (strip render) | local-only computation (no network, no relay); avg days-to-complete / stalled count / completion rate; strip is a work surface addition, tokens |
| **W6b** | `relay-hardening` | backend TS | `backend/src/routes/intake.ts`, `backend/src/lib/` rate-limit/quota, `backend/tests/` | rate-limit tuning + per-intake upload quota; quota telemetry WITHOUT content; token-before-body-read (T9); soak/abuse test; no new metadata beyond ARCHITECTURE §3 honest list |
| **W6c** | `it-pack` | docs (+ small advisor link) | `docs/trust/it-pack/INTAKE-IT-PACK.md` (finalize/integrate), fold into existing pack index (`docs/trust/`), optional advisor-UI "IT reviewer pack" link | integrate the DRAFTED pack into the standing trust-pack effort; every claim traces to ARCHITECTURE/RISKS; no overclaim (no "zero knowledge", no SOC2) |
| **W6d** | `a11y-audit` | intake-page | `intake-page/src/` (fixes), `intake-page/tests/` (axe/Playwright a11y assertions) | WCAG basics for older clients — focus order, labels, contrast, touch targets, screen-reader flow; axe pass gates; keeps page-integrity (no third-party) rule |

### Conflict map & dispatch sequencing

- Shared-file pairs (merge serially, resolve): **W5a ↔ W6a** (board/tab, `onboardingModel.ts`); **W5c ↔ W6b** (`backend/src/routes/intake.ts`); **W5b ↔ W6d** (`intake-page/src/`).
- **Batch 1 (dispatch first — minimal mutual overlap):** W5c (Rust+backend+crypto, critical, longest, deepest review), W5a (phone mode), W5b (welcome journey), W6c (IT-pack, docs).
- **Batch 2 (after their conflict-partner merges):** W6a (after W5a), W6b (after W5c), W6d (after W5b — so the audit covers the finished welcome page).
- Only W5c compiles cargo — schedule its cargo runs against the W4 lead's via COORDINATOR: lines.

---

## Per-lane ritual (every lane, in order)

1. Write `briefs/w56-<slug>.md` (scope, TDD test list, files, non-negotiables, the lane's review focus, DONE-EXIT sentinel + distinctive phrase).
2. Create lane worktree + deps (above). Dispatch Codex prompt-from-file; liveness-watch (kill + reassess if no output/commit/file-change ~10–15 min).
3. On `^DONE-EXIT:0$`: independently verify (don't trust the claim) — scoped vitest + tsc + eslint (+ cargo/bun where relevant); read the security/correctness core.
4. One `codex-review --base lp/intake-w56` with the lane's focus. Batch findings → ONE fix brief → one fix round.
5. Re-verify. Sync `lp/intake-w56` from `lp/intake` if the coordinator has advanced it. Merge `--no-ff` into `lp/intake-w56`.
6. Full `npm run gate` (serialize cargo) + backend bun where relevant. Push `lp/intake-w56`. `LANE-MERGED: <slug> <sha>`. Update the tracker below.

When both waves' lanes are merged + gate-green + pushed (HEAD==origin): `WORKER-DONE: lp/intake-w56` with full-gate evidence.

---

## Tracker

| Lane | Brief | Built | Reviewed | codex-review | Fixed | Merged (sha) | Gate |
|---|---|---|---|---|---|---|---|
| W5c key-sharing | ✅ | ⚠️→rebuild | escalated (correct) | — | 🔨 v2 building | ☐ | ☐ |
| W5a phone-mode | ✅ | ✅ 10/10 | ✅ 4 findings (2P1+2P2) | 🔨 fixing | ☐ | ☐ | ☐ |
| W5b welcome-journey | ✅ | ✅ 4/4+build | ✅ 4 findings (P2) | 🔨 fixing | ☐ | ☐ | ☐ |
| W6c it-pack | ✅ | ✅ 253/253 | ✅ 2 findings (P1 claims) | 🔨 fixing | ☐ | ☐ | ☐ |
| W6a kpi-strip | ✅ brief | ☐ (after W5a) | ☐ | ☐ | ☐ | ☐ | ☐ |
| W6b relay-hardening | ✅ brief (+expiry-cleanup) | ☐ (after W5c) | ☐ | ☐ | ☐ | ☐ | ☐ |
| W6d a11y-audit | ✅ brief | ☐ (after W5b) | ☐ | ☐ | ☐ | ☐ | ☐ |

### Adversarial-review findings log (round 1)
- **W5c key-sharing:** correctly ESCALATED — my brief wrongly treated epoch-bump as cryptographic revocation; the intake keypair can't rotate mid-flight, so an already-pulled key is unrevocable. Re-briefed (v2) as a GRANT mechanism (team decrypt + admin escrow) with honest revocation semantics (forward-grant stop + relay access cutoff + re-send-fresh-intake for true rotation). Building.
- **W5a phone-mode:** [P1] guided-answer modes (income range / spending amount) not supported → breaks one-source-of-truth; [P1] doc-slot count not enforced (license 1-of-2 marked complete); [P2] per-file size cap bypass; [P2] duplicate-filename overwrite loses a license side. → one fix round.
- **W5b welcome-journey:** [P2] firm-default saved to browser-global key (wrong-firm leak); [P2] empty role slots filled with lead advisor (solo shown 4×); [P2] editor can empty the timeline; [P2] staff-handoff message never rendered. → one fix round.
- **W6c it-pack:** [P1] 30-day expiry/grace deletion claim unimplemented in relay; [P1] new-device indicator not wired end-to-end. → fix: honest wording now; expiry-cleanup folded into W6b; session-marker gap flagged to coordinator.

## Open items / COORDINATOR flags
- Fast gates not in base `bf6fbc77`; sync from `lp/intake` before first merge (coordinator confirmed W4 lead folding now). Standard `npm run gate` is the fallback.
- Legion BENCH coordinator-gated (two-advisor decrypt bench for W5c; real-page a11y for W6d) — post-merge, on release.
- Cargo serialization shared with W4 lead.
