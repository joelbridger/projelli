# LANTERN-CRM — Program charter (READ THIS FIRST)

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
