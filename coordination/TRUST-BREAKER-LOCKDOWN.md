# Trust-Breaker Lockdown — the road to the first real advisor

> ## 🎯 CURRENT GOAL (Jameson, 2026-07-05 late): a TESTABLE, SAFE version where the whole CORE FLOW works — drive every step to GREEN.
> Jameson's exact test chain (get ALL to PASS): **connect AI key → connect files → connect email → AI search with clickable citations → record a meeting (AND the in-meeting Notice Card shows "recording") → transcript + AI summary complete → search the meeting TRANSCRIPT via Ask → draft a follow-up email with AI.**
> **The instrument:** cc-lantern-winsmoke is running this EXACT chain on the Legion right now → produces a PASS/BROKEN/CANT-TEST scorecard per step (task #24). **The loop:** get scorecard → for every BROKEN/unknown step spawn a fix immediately → re-test that step → repeat until all green.
> All the pieces EXIST (verified by code presence: email connectors, DraftFollowUpModal, noticeCard/, providers, transcription). The unknown being checked in parallel: **do meeting transcripts get indexed into Ask search?** (Codex investigation running.)
> Comms rule changed 2026-07-05: explain to Jameson like he's **10** (was 16) — codified in ~/.claude/CLAUDE.md + coordinator PLAYBOOK.md §8. THIRD correction; go noticeably simpler.
> **11 fixes merged; current tip 81e35ca7.** swallow-p0 PARKED (off this critical path — rare mail-remap edge, needs a Fable comprehensive close before merge). Second-wave findings logged: QA-84 (Calendly re-map leak), QA-85 (citation "verified" badge overstates — CORE trust, prioritize), QA-86 (vault key-missing silent orphan), QA-87 (cosmetic falsely-dirty), meetings-hardening (QA-70/83), QA-82 (co-edit typing). bench-1 running the QA-81 crash-acid-test.


**Decision (Jameson, 2026-07-05): STOP broad bug-hunting. Lock down the handful of
"trust-breaker" bugs, PROVE the app is stable, and get it in front of ONE real advisor.**

Rationale: a complex app never hits "zero bugs" — you can hunt forever. The right
finish line is *not* bug-free; it's **"nothing that would end the relationship with
the first advisor who uses it for real."** That's a short list. The campaign data
showed the scary early bugs (data loss, cross-client leak, boot crash) are mostly
killed, the newest finds are smaller/edge-casey, and some feared bugs (RAG leak)
turned out not to exist. So: finish the trust-breakers, prove stability, ship to one
human. Field use will teach us more than the 40th hunt.

This doc is the fleet's north star. Coordinator keeps status current.

## The finish line = these buckets at zero + a stability proof

A "trust-breaker" = if it hit the first real advisor, they'd stop trusting/using it.

| # | Bucket | What "done" means | Status (tip 465c74bc) |
|---|--------|-------------------|------------------------|
| 1 | **SAVE** — never silently lose/corrupt a document | autosave truthful; failed writes retried; no "said Saved, lost it" | **REOPENED (2026-07-05 pm).** cleanup4 MERGED + qa71 MERGED, BUT benchverify found **QA-81 (P0)** live on Windows: a new .docx's live typed text is only flushed on navigate-away, NOT on periodic autosave → an ordinary crash/power-loss loses it while "Saved" shows. Root-caused (periodic save never calls commitActiveRunEdit/liveFlushHook). Lane cc-lantern-savecrash (Opus) IN FLIGHT. NOT done until QA-81 merges + re-verified on Windows. |
| 2 | **LEAK** — one client's data never surfaces under another | matter isolation holds across switches, remaps, async races, sessions | **Mostly DONE.** race-p0 MERGED (QA-52..59/62 stale-async guards). QA-68 RAG cross-workspace leak **DISPROVEN** (vector store is per-workspace; verified UI+backend). swallow-p0 (mail/folder exclusion lifecycle) — round 3 IN FLIGHT (durable mail exclusion across sessions). |
| 3 | **CRASH** — app boots & stays up on real Windows | no boot crash; no panic that breaks the app until restart | **Mostly DONE.** qa60 MERGED (case-collision boot crash + permanent gate check; boot-verified live on Legion). ⚠️ rust-harden (QA-65 unicode panic, QA-66 mutex-poison cascade, QA-67 underflow) — OPEN, single Rust compile lane. |
| 4 | **CONNECTOR silent-fail** — a connector never lies about success | if it says "Connected", the data actually imports (or it shows a real error) | **IN FLIGHT.** QA-74 Wealthbox says connected but imports 0/40 households → lane cc-lantern-wealthbox. |
| 5 | **FILE-VISIBILITY** — files you add always show up | externally-added files appear without an app restart | **IN FLIGHT.** QA-75 file-watcher goes stale mid-session (QA-19 recurrence) → lane cc-lantern-filewatcher. |
| 6 | **STABILITY PROOF** | app boots & runs a clean smoke **3× in a row** on real Windows (Legion) | TODO once 1–5 land. |

## Explicitly DEFERRED (ship-with, fix-later — NOT trust-breakers)

- QA-77 tables/images in imported .docx render as placeholders — **data is safe** (round-trips), display-only.
- QA-78 superscript not rendered — preserved in XML, display-only.
- QA-76 manual edits not tracked as reviewable until first AI action.
- QA-73 stale calendar-error banner (transient).
- QA-70 meeting stuck "queued" after mid-transcription kill — annoying, not data-loss (pairs with QA-71 which IS in-scope).
- QA-79 (new) ~11 grandfathered async-swallow sites — review for real silent-failures; the docxSaveSession/MatterSyncClient ones are data-path, prioritize those.

## Gate discipline (unchanged — every merge)

Backup tag → independent codex-review from a warm worktree (`--base origin/lantern-plus`, no prompt) → verify each finding vs HEAD (proposals, not gospel) → `merge --no-ff` → `npx tsc --noEmit` + **full `npx vitest run` FOREGROUND BARE** → cargo only if the diff touches Rust (one cargo at a time) → red = `reset --hard` to the backup tag → `git push --no-verify`. Only the coordinator merges.

## Merged this session (2026-07-05, coordinator-8) — 8 fixes, current tip 965eb647

swallow-batch (775327d0) · race-p0 (8f5947fd) · qa60 (5128f2ea) · cleanup4 (b0275bb8) · guardrails (465c74bc) · qa71 (b1794baf) · rust-harden (f42ac7cf) · qa80 reindex-leak (965eb647). Both cloud benches deallocated (money).

## In flight (as of this checkpoint)
- **QA-81 (P0 data-loss, cc-lantern-savecrash, lp/savecrash-flush)** — mid-typing crash loses live text; fix sound (caret-safe persistLive shadow write), round 2 for a P2 (snapshot-on-retry) + whitespace-fidelity + IME verification. **REOPENS SAVE bucket — do not call SAVE done until this merges + re-verified on Windows.**
- **swallow-p0 (leak, cc-lantern-schedfix, lp/swallow-p0)** — round 4, definitive durable-per-workspace mail exclusion. Convergence checkpoint set (escalate, no round 5 without coordinator).
- **wealthbox QA-74 (cc-lantern-wealthbox)** — round 2 (name-link archived-matter path).
- **filewatcher QA-75 (cc-lantern-filewatcher)** — round 2 (2 keepalive races: switch-rearm + overlap guard).
- **winsmoke** — Windows smoke run #2 on current tip (verifying rust-harden Rust changes don't break Windows boot/capture). Run #1 PASSED (b1794baf). benchverify run #2 PASSED on bench-1 (b1794baf) — and FOUND QA-81.
- **QA-82 (co-edit live-typing crash gap)** — filed, fix in a careful separate lane AFTER QA-81 lands (E2EE co-edit, riskier).

## Windows stability proof status
Run #1 PASS (Legion, b1794baf) + run #2 PASS (bench-1, b1794baf). The FORMAL 3×-in-a-row must be re-run on the FINAL tip after QA-81/swallow-p0/wealthbox/filewatcher merge. Legion is the box; bench VMs deallocate when idle.

## Open decision for Jameson
sccache install (10 min) to remove the one-cargo-at-a-time limit permanently — offered, non-blocking, awaiting his yes/no. Not the current bottleneck (only 2/10 fixes touched Rust).
