# QA Sweep Handoff — 2026-06-21

**Branch:** `keepance-3.0` · **HEAD:** `d7e8d0e` (== origin, fully pushed) · **Nothing deployed** (a real build/release still needs Jameson's explicit go).

This session ran a deep, adversarial QA + security sweep of Keepance using **5 independent Codex audits** (each found 6–9 real issues) plus targeted fixes. **8 fix batches** were committed and pushed; **~17 bugs fixed** (each with a red-capable regression test); **~25 deeper findings logged** for a focused effort or Jameson's decision.

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
1. **SAVE-PATH data-integrity (BUG-045–049)** — the most valuable remaining DATA-LOSS work: stale-autosave overwrites, lost edits on Ctrl+W / workspace-switch, AI-write-vs-open-file races, `.source` "saved" before disk, version-index races. The robust fix is a **central per-path write coordinator + `flushAllDirtyTabs()`** (Codex's recommendation). **Do NOT rush it piecemeal** — a fragile partial coordinator on the core save path would risk the very data loss it prevents. Needs its own focused effort + real Win/Mac verification.
2. **Firm tier (BUG-041/050/051)** — ethical-wall local key/chunk purge on revocation, and the co-edit **CRDT lost-update** + remote-`.docx`-not-saved-locally. Firm-crypto + CRDT = xhigh-effort; needs Jameson awareness.
3. **MCP (BUG-038/039)** — external MCP reads/search are whole-workspace, not matter-scoped; "network lockdown" only blocks MCP *writes*. Architectural (the sidecar has no matter session).
4. **Matter-delete semantics (BUG-042)** — product decision: should "delete a matter" ever truly erase content (it keeps files on disk today)?
5. **Revenue / pricing / payment backend (BUG-054–057)** — firm min-3-seats not server-enforced (PRICING decision), refund/cancel/downgrade webhooks unhandled, buyer may never see their license key, client JWT not signature-verified. Deploy-gated (firm backend is live at api.keepance.com).
6. **Per-action AI-write approval (BUG-060)** + memory-fact poisoning (BUG-061) + finishing the untrusted-content framing on workflow excerpts (rest of BUG-059).

## Gotchas for the next session
- **Backgrounded `codex-task` flakes on the stdin-hang even with `< /dev/null`** (prints the prompt, exits 0, no findings). Run Codex audits in the FOREGROUND (the harness auto-backgrounds long ones, but they actually execute). Use `codex-task --read-only "<prompt>"` (NOT `codex-review`, which recurses on AGENTS.md→CLAUDE.md in this repo).
- Use `node scripts/eslint-gate.mjs` (fingerprint/count baseline) to check lint, not raw `npx eslint` (which shows all pre-existing drift).
- Untracked `docs/superpowers/plans/2026-06-20-onboarding-journey.md` is from the separate onboarding-journey work stream (PR #33, branch `feat/onboarding-journey`) — not part of this sweep; left as-is.
