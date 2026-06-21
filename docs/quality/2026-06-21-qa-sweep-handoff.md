# QA Sweep Handoff — 2026-06-21

**Branch:** `keepance-3.0` · **HEAD:** `b49edb2` (== origin, fully pushed) · **Nothing deployed** (a real build/release still needs Jameson's explicit go).

This session ran a deep, adversarial QA + security sweep of Keepance using **6 independent Codex audits** (binary blast-radius, matter-isolation, data-loss, licensing, prompt-injection, workspace-boundary — each found 6–12 real issues) plus targeted fixes. **18 fix batches** were committed and pushed; **~26 bugs fixed** (each with a red-capable regression test); **~30 deeper findings logged** for a focused effort or Jameson's decision.

**The single source of truth for every finding + status is [`docs/quality/2026-06-20-test-bug-backlog.md`](./2026-06-20-test-bug-backlog.md) (BUG-001 … BUG-061).** Read that first.

## What's reassuring (audits confirmed these HOLD)
- **Matter isolation** for AI *search* is enforced at the database level (matter filter before the query; IDs validated + SQL-escaped).
- **Your own files are NEVER locked behind a license** (`entitlements.ts` `dataAccessAlwaysTrue: true`); pre-3.0 grandfathering is handled first.
- Answers escape HTML before render; citations are verified against real retrieved chunks; email HTML is converted to text (tracking-pixel safe); local-only mode blocks cloud egress (round-3 BUG-021).

## Fixed + pushed this session (commits f51a3fc → d7e8d0e)
- **Binary file integrity** (BUG-033/034/035): byte-safe download/move/copy + a broadened `isBinaryFile` classifier (+ Codex-review refinements: dropped ambiguous `.ai`/`.fig`, gated the content-indexer so big binaries don't spike memory).
- **Confidentiality report** names the model instead of "unknown" (BUG-028); reconciled 6 stale-but-already-fixed backlog entries.
- **Matter-isolation hardening** (BUG-036/037/040): chat file tools + open-file context now respect the active matter (a chat scoped to Matter B can no longer reach Matter A's files); deleted-matter index purge. Shared guard `src/platform/matter/matterScopeGuard.ts`.
- **Data-loss hardening** (BUG-043/044): atomic `.docx` save (crash-safe temp+fsync+rename); workflow terminal record is awaited.
- **Licensing** (BUG-052/053): closed the `?fakeLicense=` production backdoor; gated inline AI editing by the same entitlement as chat/redline.
- **Prompt-injection hardening** (BUG-059): untrusted text (open files, PDF attachment text, email "Draft with AI") is now sanitized + framed as "DATA, not instructions."
- Workflow model fallback (BUG-025), trust-bar honesty + settings import (BUG-023/026), and the round-3 privacy/data-loss fixes (BUG-021/022/027/029/030/031/032) all landed too (see backlog).

## Gates (green as of the last push)
- `npm run typecheck` clean; full Vitest **3545 passed / 3 skipped**; pre-push hook (typecheck + vitest) passed on every push.
- Rust: `cargo check` clean; `cargo test` for the touched areas green (atomic-write 4, rag_delete_matter 3, docx).
- **ESLint CI gate:** my work adds **ZERO net new findings**, BUT there are **~15 PRE-EXISTING low-severity drift findings** (App.tsx, useFileOperations react-compiler memoization, MailConnect i18n, fileDrop, mail-commands, localOnlyGuard) not in `.eslint-baseline.json` that make the CI `quality` job red independent of this work. Separate CI-health cleanup — verify your own delta with `git stash -u` → run `node scripts/eslint-gate.mjs` → compare; bump only YOUR tuples, don't blanket `--update-baseline` (it would bury the drift).

## Biggest OPEN clusters (need Jameson's decision OR a focused, careful effort)
1. **SAVE-PATH data-integrity (BUG-045–049) — ✅ DONE 2026-06-21 (commits `59c47f1` → `b49edb2`), except one product decision.** Built the central per-path **`WriteCoordinator`** (`src/platform/fs/writeCoordinator.ts`) + revision-checked `markSaved` + the `flushDirtyTabs` primitive, all TDD'd. Fixed: BUG-045 (stale-autosave overwrite / wrong-clean — Critical), BUG-046 (flush dirty tabs on workspace-switch, app-close/reload, AND every tab-close via the `closeTab` `beforeTabClose` chokepoint — Critical), BUG-048 (`.source` "saved"-before-disk), BUG-049 (version-index read-modify-write race). **Still OPEN:** BUG-047 (AI/tool write to a file you have open with UNSAVED edits — needs your UX decision: block + show a diff/merge? warn? overwrite?) — overlaps BUG-060 (per-action AI-write approval). Plus two minor BUG-049 residuals (rebuild history from snapshot files when index.json is corrupt; size-cap the in-memory `.docx` read) and a fully-awaitable Tauri `onCloseRequested` (pagehide can't await — bench).
2. **Firm tier (BUG-041/050/051)** — ethical-wall local key/chunk purge on revocation, and the co-edit **CRDT lost-update** + remote-`.docx`-not-saved-locally. Firm-crypto + CRDT = xhigh-effort; needs Jameson awareness.
3. **MCP (BUG-038/039)** — external MCP reads/search are whole-workspace, not matter-scoped; "network lockdown" only blocks MCP *writes*. Architectural (the sidecar has no matter session).
4. **Matter-delete semantics (BUG-042)** — product decision: should "delete a matter" ever truly erase content (it keeps files on disk today)?
5. **Revenue / pricing / payment backend (BUG-054–057)** — firm min-3-seats not server-enforced (PRICING decision), refund/cancel/downgrade webhooks unhandled, buyer may never see their license key, client JWT not signature-verified. Deploy-gated (firm backend is live at api.keepance.com).
6. **Per-action AI-write approval (BUG-060)** + memory-fact poisoning (BUG-061). _(The untrusted-content framing on workflow excerpts — the rest of BUG-059 — is now DONE, commit `3f079b4`.)_
7. **Workspace-boundary hardening (BUG-062)** — the symlink escape (genuinely reachable) + Rust native commands trusting caller-supplied absolute paths (reachable via a compromised renderer). Robust fix = ONE canonical workspace guard in trusted Rust state, canonicalizing both root + candidate (handles macOS `/var` symlink trap), routing every native fs/docx/vault/rag/convert command through it. **Needs real Win/Mac verification** — do NOT rush piecemeal. The frontend `PathValidator` itself is solid.

## Gotchas for the next session
- **Backgrounded `codex-task` flakes on the stdin-hang even with `< /dev/null`** (prints the prompt, exits 0, no findings). Run Codex audits in the FOREGROUND (the harness auto-backgrounds long ones, but they actually execute). Use `codex-task --read-only "<prompt>"` (NOT `codex-review`, which recurses on AGENTS.md→CLAUDE.md in this repo).
- Use `node scripts/eslint-gate.mjs` (fingerprint/count baseline) to check lint, not raw `npx eslint` (which shows all pre-existing drift).
- Untracked `docs/superpowers/plans/2026-06-20-onboarding-journey.md` is from the separate onboarding-journey work stream (PR #33, branch `feat/onboarding-journey`) — not part of this sweep; left as-is.
