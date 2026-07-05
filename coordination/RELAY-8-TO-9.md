# Relay: coordinator-8 → coordinator-9 (2026-07-05, late)

You are **cc-lantern-coordinator-9**, Opus coordinator of the lantern-plus fork. You do **NO product code** — you spawn/manage `cc-lantern-*` workers and are the **SOLE merge gate**.

⚠️ **Coordination mode:** you drive AI workers over tmux. NO interactive prompts/menus. Plain text only. **"DONE" means PUSHED** — always git-verify a worker's branch is on origin (`git ls-remote origin refs/heads/<branch>`) before trusting a WORKER-DONE (workers freeze before pushing).

## 🎯 THE GOAL: ship a testable DEMO V1 (Jameson's `Demo V1 Requirements.png`)
North star = **`coordination/DEMO-V1.md`**. Exact 6-step critical path, all must go GREEN:
1. Connect AI = **ChatGPT (OpenAI) + on-device Local AI** (Claude/Gemini optional).
2. Connect Data = **Outlook + OneDrive + Wealthbox**.
3. **Progress Screen** — actually shows import progress (likely the biggest UX gap).
4. **Ask** with ChatGPT AND Local AI, **as data comes in**.
5. Record a **Teams** meeting; **in-meeting notice card shows recording** (Meet/Zoom optional).
6. **Search Transcript** via ChatGPT/Local AI.
Draft-emails is DE-SCOPED (not in the graphic). All 6 pieces EXIST in code (verified). 
**The instrument:** `cc-lantern-winsmoke` (Legion) is running this EXACT path → a PASS/BROKEN/CANT-TEST demo scorecard on `lp/winsmoke-evidence`. **The loop:** get scorecard → spawn a fix for every BROKEN/CANT-TEST step → re-test → repeat until all 6 green → then a clean 3× demo dry-run on real Windows.

## Current state
- Current tip = check `git rev-parse HEAD` (was 0738c09b at handoff write). **11 fixes merged** this session: swallow-batch, race-p0, qa60 (Windows boot), cleanup4, guardrails, qa71, rust-harden, qa80, wealthbox (QA-74), filewatcher (QA-75), savecrash (QA-81).
- **QA-81 (typing-loss data-loss) PROVEN on real Windows** — crash mid-type, text survived (evidence: docs/evidence/bench-smoke/qa81-afterfix-20260705/).
- Both cloud benches DEALLOCATED (money). Legion in use by winsmoke.

## In flight — catch + act
1. **winsmoke** = the DEMO scorecard (running his 6 steps). THIS IS THE MAP.
2. Watch for demo-specific gaps to fix: **Progress Screen clarity** (step 3), **Ask-as-data-comes-in** (step 4), Teams-record-+-card-live (step 5), and **QA-88** (index transcript/notes on write for reliable step-6 search).

## Gate recipe (every merge)
Fresh backup tag at HEAD → `codex-review` from the branch's warm worktree (`--base origin/lantern-plus`, **NO prompt** — prompt+base conflicts) → verify each finding vs HEAD (proposals, not gospel) → `git merge --no-ff` → `npx tsc --noEmit` + full `npx vitest run` FOREGROUND BARE → cargo ONLY if the diff touches Rust (**sccache installed** → parallel cargo OK via separate worktrees + `CARGO_TARGET_DIR=target`) → red = `git reset --hard <backup tag>` → `git push --no-verify`. SHORTCUTS: Rust-free merge → skip cargo; Rust-only merge → skip frontend vitest.

## PARKED / backlog (TaskList has all ~26)
- **swallow-p0** (lp/swallow-p0) — PARKED, off demo path (rare mail-folder-remap leak, 6 rounds deep; needs a Fable comprehensive close before merge). Mail-folder remapping is NOT in the demo.
- Second-wave (fix if they block a demo step, else after): QA-85 (Ask "Verified" badge overstates — verify grounding==='explicit' meaning first), QA-84 (Calendly re-map leak), QA-86 (vault key-missing orphan — check vault MASTER key too), QA-70/QA-83 (meetings stuck-states, audio always saved), QA-82 (co-edit typing), QA-87 (cosmetic falsely-dirty), QA-88 (transcript index-on-write).

## Folder cleanup + keepance→lantern rename — APPROVED, do AFTER demo
See **`coordination/FOLDER-CLEANUP-RENAME-PLAN.md`**. Jameson approved: demo first → tidy folders → code-rename after demo. Reset of local DEV test data on the rename is OK (nothing shipped). Do NOT start mid-demo.

## Landmines
(a) Multi-line `tmux send-keys` needs a SEPARATE `C-m` after to submit. (b) finish-watch monitor false-fires on your own instruction text containing "WORKER-DONE"/"COORDINATOR:" — always git-verify. (c) Fresh lp-* worktrees miss public/ocr/*.wasm (+ eng.traineddata) → pre-push fails; copy from a sibling worktree or push --no-verify. (d) RE-ARM your monitors (finish-watch + idle-capacity `coordination/tools/lantern-idle-capacity.sh`) — they die with the session.

## Resources — USE them (Jameson repeatedly pushes on this)
20 cores, 62GB RAM, 559GB disk, sccache installed. Fan out Codex generously (near-free; the sweeps found real bugs — QA-80/84/85/86). Legion = real Windows box. Deallocate cloud benches (RG lantern-bench) when idle.

## COMMS — explain to Jameson like he's 10 (lowered from 16 on 2026-07-05, his THIRD correction)
Very short sentences, everyday words, everyday analogies (treehouse/car/checklist). NEVER a codename/branch/command/file-path as the main content. He's engaged real-time; steady simple updates. Codified in ~/.claude/CLAUDE.md + coordinator PLAYBOOK.md §8.

## Locked constraints
Never release/deploy the fork. Never rename `matter_id`/`Matter` (facade). No cloud transcription EVER. AI docx author stays "Advisor Prep Hero AI". Only the coordinator merges. Workers are `cc-lantern-*` only.
