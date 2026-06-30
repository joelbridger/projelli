# 2026-06-22 — Next-session handoff (paste the block below into a fresh session)

```
You are continuing work on Advisor Prep Hero (~/keepance). Read this whole block first, then read the
two pointer docs it names before doing anything.

CONTEXT / WHY
Advisor Prep Hero is repositioning to "private client intelligence" with a bottoms-up "start on your own"
wedge (a solo professional can download and safely use it alone, then bring it into their firm).
Two work missions were handed off by a marketing session. A reconciliation + plan was written and
Jameson approved a HYBRID approach: build the wedge in the foreground; run the leftover Windows
reliability fix on a background track. READ THESE FIRST, in order:
  1. docs/operations/2026-06-22-work-reconciliation-and-plan.md   (the plan + progress log)
  2. docs/superpowers/specs/2026-06-18-bottoms-up-wedge/00-START-HERE-situation-and-two-missions.md
     (+ 01-design-spec.md, 02-implementation-plan.md, 03-copy-deck.md in that folder)
  3. ~/keepance/CLAUDE.md (model/effort policy + voice rules) and ARCHITECTURE.md
Jameson is NOT a developer: explain in plain language, no jargon/stack traces. Communicate like
he is a smart 16-year-old; define any technical term the first time.

CURRENT STATE
- Repo ~/keepance, branch keepance-3.0 @ 34c53790, tree CLEAN, pushed, origin in sync.
- Gate GREEN at the last code commit ba07588d (pre-push hook ran full unit suite ~3815 pass +
  typecheck 0; eslint gate clean). 34c53790 is docs-only.
- NOTHING is deployed. No build cut. Cutting a signed build/deploy is Jameson's EXPLICIT go only.

DONE THIS SESSION (Mission 1, all committed + pushed on keepance-3.0)
- Phase 1 (safe-by-default) — Tasks 1.1-1.4. A personal (non-firm) install never sends content to a
  cloud AI for GENERATION until the user makes an explicit confidentiality choice. Gate =
  assertCloudGenerationAllowed() in src/platform/privacy/localOnlyGuard.ts, called on the CLOUD
  branch of every generation path (chat, Ask, email draft, matter at-a-glance, workflow, redline,
  inline edit, run-on-all, fact-extraction, compression). Local Ollama, retrieval/search, and firm
  installs are NOT gated. Two Codex adversarial passes + reviews closed ~7 bypasses and 1 over-gate.
- Phase 2 (honest first-run) — Task 2.1. Onboarding informed-choice screen (Local-only / Cloud BYOK /
  Decide later) wired to useRecordConfidentialityChoice; firm seats bypass to the unchanged setup.
- Phase 3 (firm security pack PDF) — Task 3.1. src/features/privacy/FirmSecurityPack.tsx + entry point
  in PrivacyCenterHome.tsx. Honest assurance status (NOT SOC 2 certified; DPA available; Assured proxy
  disclosed as not-yet-GA per DPA-template.md §6.4).

NEXT STEPS (priority order — Jameson paused for a fresh session for these)
1. Mission 2 — THE CLIENT MAP (the big strategic bet; the website markets it as "coming"). This is
   net-new and REQUIRES a brainstorming interview WITH Jameson before building (his product call). Run
   the verbatim kickoff in the 00-START-HERE brief: brand/names are LOCKED (umbrella "private client
   intelligence"; object "Client Map"; sub-features "Context Completeness", "Guided Client Interview",
   "Firm Philosophy" framed as "stores and applies", never "learns"). Use superpowers:brainstorming
   ONE question at a time with a recommended answer each time; then write the spec to
   docs/superpowers/specs/2026-06-22-client-map/ and build with superpowers:subagent-driven-development.
2. Mission 1 Phase 4 (Task 4.1 in 02-implementation-plan.md) — solo-to-firm bridge + matter carry-over.
   The RISKIEST/biggest build phase (touches the firm subsystem + the matter store; "carry matters into
   a firm without duplicating data"). Slow down, plan, verify.
3. Mission 1 Phase 5.1 — frictionless trial (no-card, no-account, full-feature, 30 days) + solo license
   recovery. Small. (Phase 5.2 website = SKIP, marketing owns it; do NOT touch website/.)
4. Windows QA: review + merge + bench-verify the BUG-099 fix (below).

BUG-099 (Windows reliability, background track) — WIP, NOT merged, NOT bench-verified
- Committed on branch harden-rag-indexer (worktree .worktrees/harden-rag-indexer) @ 32e451e8. Rust-only
  (src-tauri/src/commands/rag/mod.rs): per-file logging + 5-min per-file time-box + skip-on-fail/timeout
  so one bad file can't stall the whole index; completion marker still writes. cargo test rag = 152 pass.
- BEFORE merging: lead review of the diff + an independent (Codex) review + a Windows-bench full-index
  run (read the new per-file logs to find the file that stalls; confirm the walk completes, writes the
  marker, no memory runaway). Then merge to keepance-3.0. DO NOT re-apply the reverted forced-reindex
  commit f98aac6 (it crashed on launch via memory runaway).

EXECUTION METHOD + KEY FILES
- Use superpowers:subagent-driven-development. The progress ledger is .superpowers/sdd/progress.md
  (gitignored scratch, present locally) — read it to see exactly what's done; per-task brief/report
  files are in .superpowers/sdd/ too.
- Implementation subagents: model "sonnet" per the Advisor Prep Hero token policy; Opus (you) orchestrates +
  reviews. Use Codex (codex-task / codex-review / codex-collab skill) for independent adversarial review
  before shipping — it caught real bugs this session.

GATES + COMMANDS
- npm run typecheck   (must be 0)
- npx vitest run <path>   (focused)   ·   npx vitest run   (full)
- node scripts/eslint-gate.mjs   (run this separately — the pre-push hook does NOT run eslint)
- npm run gate   (full pre-merge). Commit per task. Co-author trailer:
  "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"

LANDMINES / GOTCHAS (learned this session)
- A delegated subagent FABRICATED a result once (claimed a commit SHA + test counts that did not exist).
  VERIFY safety-critical subagent work yourself: confirm the commit exists in git log AND run the tests
  with your own eyes. Do not trust the report.
- The safe-by-default gate must be called on the CLOUD branch only (after the cloud-vs-Ollama decision),
  NEVER before the key lookup, or it over-blocks a no-cloud-key user who would use local Ollama.
- Hard rules (each is a defect, some have tests): no silent cloud fallback; firm installs byte-for-byte
  unchanged (branch on isFirm/useFirm); NEVER claim "guaranteed/fully compliant"; NO em dashes in
  user-facing strings; use copy-deck strings VERBATIM; do NOT touch website/; no build/deploy without
  Jameson's explicit go.
- Server is memory-tight: do NOT run a Codex Rust (cargo) compile at the same time as the full vitest
  suite — that combo briefly froze the SSH terminal via swap-thrash this session. Only ONE cargo compile
  at a time; TS/non-compiling Codex jobs fan out freely.
- The .superpowers/sdd/scripts/task-brief script matches by task NUMBER ordinal; it errored on some
  numbers. If it fails, just hand the implementer the plan file path + the task's line range, or write a
  small brief file by hand (that's what was done for Task 3.1: task-secpack-brief.md).
```
