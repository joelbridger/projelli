# Trust-Breaker Lockdown — the road to the first real advisor

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
| 1 | **SAVE** — never silently lose/corrupt a document | autosave truthful; failed writes retried; no "said Saved, lost it" | **Largely DONE.** QA-34/43 verified holding (file-lock + reboot). cleanup4 MERGED (2 edge cases: flush-after-error retry, remount hook guard). ⚠️ QA-71 (dangerous "delete audio" copy destroys only copy when no transcript) — OPEN, needs a small lane. |
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

## Merged this session (2026-07-05, coordinator-8)

swallow-batch (775327d0) · race-p0 (8f5947fd) · qa60 (5128f2ea) · cleanup4 (b0275bb8) · guardrails (465c74bc). 3 P0s + 2 P0-labeled among them. Both cloud benches deallocated.
