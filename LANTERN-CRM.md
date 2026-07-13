# LANTERN-CRM — Program charter (READ THIS FIRST)

> ## 🔴 CODEX IS OFF (2026-07-13) — CLAUDE MODELS ARE THE DEFAULT WORKERS
> Jameson ran out of Codex tokens and moved to a new Anthropic account. **Every "delegate to Codex / codex-task / gpt-5.6-terra / gpt-5.6-sol" instruction in this file is SUPERSEDED.** Use: **Sonnet 5** = default worker · **Haiku 4.5** = mechanical volume · **Opus 4.8** = coordinator + hard/critical lanes + review · **review must use a different model than the builder**. **Fan out 3-5 concurrent workers, NOT 8-12** (that number was Codex economics — Claude workers cost real tokens and real RAM). The cross-model safety check is gone: compensate by DRIVING the real packaged product on the real OS and prompting reviewers adversarially. Full policy: `~/.claude/CLAUDE.md` OVERRIDE block + memory `feedback_claude_workers_default.md`.



**Created 2026-07-11 by Jameson's direct instruction.** This folder is a **full, isolated
fork of Lantern** (cloned from `~/lantern-plus` at `0971d8f3`, branch **`lantern-crm`**)
whose single mission is the **one-shot build of Path 4: Lantern as a small RIA's system of
record** — a complete CRM that replaces Wealthbox (and Jump) for firms of ≤10 people.

Jameson's explicit directive (2026-07-11): go full speed on the extra-aggressive path,
**consciously setting aside the cons and gates** documented in
`~/lantern-plus/user-research/09-strategic-path-options.md` and `10-path4-deep-dive.md`.
Those documents remain the program's evidence base; their *caution* does not govern here.
This is a sandbox where breaking things is acceptable.

## The one-shot workflow (Jameson's explicit choice — do not "improve" it)

1. **DESIGN EVERYTHING FIRST.** The entire CRM — every Wealthbox feature, every screen,
   the data model, sync, migration — is designed end to end as ONE coherent system, then
   adversarially reviewed and **frozen** (`design/SPEC-FREEZE.md`).
2. **BUILD EVERYTHING.** One big build wave against the frozen spec. Lanes parallelize by
   subsystem with contracts from the spec. **No lane pauses for user testing; no
   design-build-test loops.** Elegant, unified design over iterative patchwork.
3. **TEST EVERYTHING AFTER.** The full test campaign (pre-written in the design phase)
   runs against the complete system; fixes come from its bug list.

## Ground rules

- **Isolation:** NEVER touch `~/lantern-plus`, `~/keepance`, or `~/lantern` from here.
  Never push to `lantern-plus` or `keepance-3.0` branches — this program pushes ONLY
  `lantern-crm` and `crm/*` branches to `github.com/lanternplatform/lantern`.
- **No deploys, no releases, no real client data — ever.** Test data = the fabricated
  Northcrest practice (`~/lantern-demo-data`, 80 households, 374 docs) and synthetic
  fixtures only.
- **Inherited invariants that still bind even in a sandbox:** never rename
  `matter`/`matter_id` (facade rule); the E2EE relay must NEVER be able to read content;
  AI proposes → user approves for all external writes; light theme; no em dashes in
  user-facing copy; no time estimates in docs.
- **Rust builds:** this fork uses its own `./target` (global sccache shares compiled
  artifacts). Still only ONE cargo compile at a time server-wide.
- **Shared resources (Jameson, 2026-07-11): do NOT use the Legion test-bench laptop or any
  other resource the mainline session could be using** — this program runs on this server
  + Codex only. When the 06 test campaign's Layer 3 needs the Legion bench, coordinate
  through BOARD.md and get an explicit go first.
- **🚨 SUBAGENT ROUTING (Jameson, 2026-07-12 — REAFFIRMED + SHARPENED):** **ALL crew/helper work is CODEX** (`codex-task`, gpt-5.6-terra, high). Codex tokens are plentiful; Claude tokens are scarce. **Never spawn Claude subagents for crew work.** If a lane is genuinely correctness-critical and MUST be Claude, it runs **Sonnet 5 — never Fable** — and the coordinator states a one-line justification in its check-in. Effort tiers: hold current settings until Jameson confirms. The only Anthropic model in this program remains the Fable 5 coordinator itself (planning, review, merging).
- **🚨 MODEL ROUTING (Jameson's explicit rule for this program, 2026-07-11):** ALL work —
  design lanes, build lanes, test lanes, investigations — is done by **Codex
  (`codex-task`, gpt-5.6-terra, high reasoning effort)**. The ONLY Anthropic model in the
  program is the coordinator itself (**Fable 5, high effort**) doing planning, lane
  orchestration, spec unification, review gating, and merging. Do NOT spawn Claude
  subagents for work in this program. (Exception already spent: the first five design
  lanes of 2026-07-11 ran on Claude while Codex was quota-limited; their outputs stand but
  every one of them gets Codex adversarial review before the spec freeze.) Standard Codex
  hygiene binds: prompt as a real argument with stdin closed, liveness-watched, one
  cargo-compiling job at a time, `--worktree` for parallel writers.

## Pre-made architecture decisions (locked unless the design phase proves them wrong)

From the code-verified feasibility read
(`~/lantern-plus/user-research/analysis-drafts/crm-core-feasibility.md`):
1. All CRM records live in the **Rust SQLCipher store from day one** — never browser
   localStorage.
2. Tasks, workflow instances, and all shared records are **CRDT-friendly mergeable
   documents with stable IDs** from day one (Yjs-compatible, like the existing co-editing).
3. **Notifications = encrypted envelopes** through the relay: the server learns only
   "member X has N pending envelopes" (timing/count metadata), never content. Polling is
   the fallback if envelopes prove leaky in review.
4. **Small-firm boundary:** every member's device syncs the firm's task/activity docs;
   nothing requires a server-side view. Target ≤10 seats; enterprise is out of scope.
5. **No mobile app** (existing product principle). Phone-shaped needs are met by
   responsive intake-style links where the spec calls for them.
6. Workflow-template **propagation to open instances** is the marquee feature and the
   hardest correctness problem — it gets the strictest review treatment in both phases.

## Design phase — lane map (deliverables in `design/`)

| Lane | Deliverable | Content |
|---|---|---|
| A | `design/01-wealthbox-feature-matrix.md` | Every Wealthbox feature (public docs + API), each marked replicate / improve / skip-with-reason; JBW usage cross-check |
| B | `design/02-data-model.md` | Entities, fields, provenance/dating, storage schema (SQLCipher), CRDT doc shapes, matter-facade mapping |
| C | `design/03-sync-and-notifications.md` | Multi-user sync over the E2EE relay, envelope notifications, offline/conflict semantics, workflow-propagation merge algorithm |
| D | `design/04-screens-end-to-end.md` | Every screen and flow, one design system, written after A+B land |
| E | `design/05-migration-importer.md` | Wealthbox API → Lantern importer, fidelity report, parallel-run/write-back mode, cutover + rollback |
| F | `design/06-test-campaign.md` | The exit exam: full-gate additions, multi-user sim, Northcrest drive-through week on the Legion bench, fidelity checks |
| — | `design/00-master-spec.md` | Coordinator's unification: contracts between subsystems, build-lane map |
| — | `design/SPEC-FREEZE.md` | Freeze record: review rounds passed, open risks accepted |

**Review before freeze:** ≥2 adversarial review rounds of the unified spec (Codex +
independent Claude reviewer), attacking correctness (propagation, sync), privacy (relay
blindness, envelope metadata), and completeness (feature matrix vs screens vs data model).

## Evidence base (read before designing)

- `~/lantern-plus/user-research/10-path4-deep-dive.md` — the program's blueprint (§4
  design principles, §5 initial designs, §6 architecture, §7 migration).
- `~/lantern-plus/user-research/analysis-drafts/crm-core-feasibility.md` — code-verified
  rails and risks (repo paths inside).
- `~/lantern-plus/user-research/analysis-drafts/crm-market-research.md` — Wealthbox
  pricing/features/market, dated sources.
- `~/lantern-plus/user-research/01-evidence-ledger.md` — the advisor-research evidence
  (E-### items); design decisions cite these where applicable.

## Status log

- 2026-07-11: Fork created at `0971d8f3`; charter written; design lanes A/B/C/E/F launched
  (D follows A+B). — coordinator session
- 2026-07-11 (later): All six design docs on disk. Review round 1 done (Codex cross-doc: 20
  findings; Codex sync attack: ~14 blockers — both in design/reviews/). Coordinator
  decisions D1-D11 recorded in design/00-master-spec.md (D11 = Jameson's Home-tab IA
  decision). Reconciliation lanes R1-R6 complete and committed @ 8307ff52. Live Wealthbox
  API probe evidence in design/evidence/ (key: open workflow instances + attachments NOT
  API-readable — 05 needs a post-probe amendment). Parallel tracks: relay live-sync bug
  FIXED test-first on worktree branch (commit ac8cfb32, needs merge); multi-client harness
  lane in flight; baseline gate in flight. NEXT: fold probe into 05 (small R7), round-2
  adversarial review (fresh cross-doc + second sync attack + 04-vs-reconciled-contracts),
  then SPEC-FREEZE.md, then the build wave. Coordination protocol with the mainline
  session posted to ~/lantern-coordination/BOARD.md (compile windows; re-read at every
  checkpoint).
- 2026-07-11 (baseline): first `npm run gate` on the untouched fork = RED with 5 failures, ALL 5s-timeouts (DocxEditor menu test, SourcePanel cache tests, +2), run while ~12 Codex jobs loaded the box. Likely load-induced flakes, NOT confirmed inherited breakage. REQUIRED before build wave: re-run the gate on a quiet machine; only a clean re-run counts as the green baseline. Log: scratchpad crm-baseline-gate.log (session-tmp; re-run if gone).
- 2026-07-11 (resume, ~16:20): Coordinator reviewed + MERGED both worktree branches into `lantern-crm` (pushed @ dc752ebb): the relay live-sync catch-up fix (subscribe-first + bounded `since`-cursor backfill; 37/37 relay tests green) and the multi-client harness (`npm run test:multiclient` — PASSES on the merged tree: 3 real clients, concurrent edits + offline/rejoin convergence over the real relay). R7 done by Codex + merged: design/05 amended with the live-probe findings (workflow-instance guided re-creation fallback §2.5a, attachment operator-export + gap flags §2.5b, page-cap/tags/activity-cursor corrections, seeded re-probe plan §6.4). Merged worktrees pruned. ROUND-2 adversarial review in flight (3 read-only Codex jobs: fresh cross-doc, second sync attack on 03, 04-vs-contracts). Baseline gate re-run DEFERRED: mainline session's tsc/vitest fleets have the box at load ~59 (their load flaked round 1); load watcher armed, window request posted to BOARD. NEXT: fold round-2 findings → SPEC-FREEZE.md → build-lane map → build wave.
- 2026-07-11 (🎉 SPEC FROZEN + BUILD WAVE LAUNCHED): Round-3 (closure 41/46 + fresh-drift FD-1..14) adjudicated as D26; lanes R13/R14 merged (coordinator-reviewed); anchors machine-verified; seeded re-probe evidence merged (Projects shape proven; custom-field registry readable at /categories/custom_fields — 05 corrected; open-workflow readability STILL unproven → guided fallback stands; UI seeding parked on a Wealthbox login Jameson can do whenever — non-blocking). **design/SPEC-FREEZE.md committed; frozen tree = c016f2a3.** Build-lane map B1–B10 in 00. NINE lanes launched (Codex worktrees crm-b*): B1 store (sole cargo lane, BOARD notified), B2 relay, B3 sync, B4 notify, B5 propagation, B6 ui-home, B7 ui-clients, B9 retention, B10 test-campaign. **B8 importer launches when B1 frees the cargo lane.** Quiet-box gate baseline still owed — REQUIRED before the FIRST wave merge (watcher armed).
- 2026-07-11 (⚠️ HONEST STATUS CORRECTION — "gate green" ≠ "product works"): The full `npm run gate` is GREEN on the merged wave (tag `wave-green-gate`, verified on the new tailnet-only `crm-gate-runner`), and the ENGINES are genuinely built + tested (35 Layer-1 assertions incl. P1–P10; Layer-2 = 6/6 system scenarios on the real relay; Layer-4 fidelity drive PASSES after fixing exam-bug #1 — the report omitted zero-count rows, which would have HIDDEN attachment gaps in a real migration; Layer-5 trust-breaker battery = 5 attack groups, 0 vulns). **BUT the first live-app run proved the SCREENS are still presentational shells: they do not drive the engines.** Households + tasks now persist (live-record bridge merged); everything else (workflows, propagation review, migration, Today, approvals) is placeholder UI, and onboarding hangs at "Opening…" on a fresh workspace. A green gate + green engine tests could not catch this because nothing had ever RUN the app. → **WIRING WAVE W1–W4 dispatched** (W1 onboarding blocker + Clients [cargo lane], W2 workflows/propagation, W3 Today/Tasks [kills the fake counts], W4 migration wizard). ACCEPTANCE BAR RAISED: a lane is done only when its flow is DRIVEN in the running app (CDP + screenshots) and PERSISTS across restart — unit tests are no longer acceptance. Independent UX audit merged (design/reviews/2026-07-11-built-screens-ux-audit.md): 3 P0s (fake Today counts, revision-graph jargon in propagation review, jargon in migration) — folded into the W-lane briefs. Layer-3 (bench drive-through) stays BLOCKED until W1–W4 land; bench-2 is campaign-ready and waiting.
- 2026-07-11 (wave merged + gate triage): ALL TEN lanes merged (each coordinator-reviewed; UI lanes passed an adversarial Codex pre-review + fix round; one missing-import compile error caught+fixed at the merge gate; scoped cargo 193 green). B10b exam fill-in merged: 35 REAL Layer-1 assertions incl. P1–P10 one-for-one, 22 WIRE-PENDING. Research handoff written at Jameson's direction (~/lantern-coordination/USER-RESEARCH-IMPLEMENTATION-HANDOFF.md) and ACKED by mainline. Full `npm run gate` on the wave: RED — (a) ~12 strict-TS errors (integration lane contractually fixes), (b) reimagined-spine test asserts pre-wave IA (update owed at wire-merge), (c) resource flakes from parallel load. WIRE-TOGETHER lane in flight (31 seams / 19 files). NEXT: wire-merge (+ spine-test fix) → quiet full gate (window re-request posted to BOARD) → test campaign Layers 1–2 → Layer 3 needs Jameson's go on a bench (Legion forbidden; mainline offered cloud bench-2, costs money).
- 2026-07-11 (round 2 verdicts): all three round-2 reviews landed NOT-READY — 15 blockers total (xdoc 5, sync 4, screens 6; reports in design/reviews/*round2*). Root cause of most: 02 was never converted to 03's reconciled revision-graph/topology model, and 04 predates the reconciled contracts. Coordinator adjudicated EVERY finding as binding decisions **D12–D25** in 00-master-spec (§Round-2 adjudication) and dispatched reconciliation lanes **R8–R12** (5 parallel Codex worktrees, one doc each: 02, 03, 04, 06, 01). After they merge: round-3 closure review → SPEC-FREEZE.md. Baseline gate still HELD for a quiet box (mainline vitest fleets churning; stricter watcher armed; BOARD updated honestly after a false-start claim was withdrawn).
