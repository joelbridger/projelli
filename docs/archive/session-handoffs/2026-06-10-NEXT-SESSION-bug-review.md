# Next session: Advisor Prep Hero 3.0 software bug review

**Read this first.** This is the entry point for the bug-focused session. The launch is done; the next job is finding and fixing **actual software bugs** in the 3.0 app.

## Where things stand (do NOT redo this)

Advisor Prep Hero 3.0 is **launched and live**:
- **App:** `v3.0.0` published (signed Win/Mac/Linux installers + auto-update). Released from branch `keepance-3.0`.
- **Website:** keepance.com on the 3.0 positioning + pricing, with working Subscribe links.
- **Firm backend:** live at `https://api.keepance.com`.
- **License validator:** on a live LS API key; real purchases validate.

All code is on branch **`keepance-3.0`** (clean, pushed). The repo opens on it.

The only open launch/sales items are **not bugs** and are tracked separately (task #60 / `docs/operations/2026-06-10-lemonsqueezy-3.0-LIVE.md`): the founding coupon's product list, Firm multi-seat, and a real test purchase. Leave these unless asked.

## The job: find and fix real bugs in the 3.0 software

3.0 is a large, fast-built release. The highest-risk surfaces are the **newly built 3.0 features**. Use the `## [3.0.0]` entry in `CHANGELOG.md` as the feature map. The areas most likely to harbor bugs:

| Area | Key files | What to scrutinize |
|---|---|---|
| In-house OOXML engine | `src-tauri/crates/keepance-docx/` | round-trip fidelity, tracked-changes accept/reject, run-splitting in `author.rs`, malformed/edge-case .docx |
| Word-familiar editor | `src/components/media/DocxEditor.tsx`, `src/utils/docx-*.ts` | rendering, accept/reject correctness, the user-edit-as-tracked-change diff path |
| AI redline | `src/modules/docx/redline.ts` | anchor drift, paired replace (del+ins), edits applied against the original |
| Matter-scoped cited recall | `src-tauri/src/commands/rag/`, `src/modules/memory/` | isolation (Matter A never returns Matter B), citation verification, "All matters" path |
| Trust layer / privilege | `src/modules/privacy/`, `src/components/privacy/` | egress indicator accuracy, privilege exclusion from retrieval, Local-only never falling through to cloud |
| Litigation associate | `src/modules/workflow/legalAnalysis.ts`, `templates/legal/` | unverified-citation flagging, Word output |
| Firm tier | `src/modules/firm/`, `backend/` | sign-in/seat/keychain, matter sync convergence, assured routing, entitlement decisions |
| Email | `src-tauri/src/commands/mail/` | sync resume/throttle, encryption at rest |
| Encryption / keychain | SQLCipher + AES-GCM paths | key handling, at-rest guarantees |

## How to approach it

1. **Start from green, then look for gaps.** Run the suites and confirm they pass, then look for what they DON'T cover:
   - Frontend: `npm run test` (Vitest, ~2500+ tests) and `npx tsc --noEmit`.
   - Rust: `cd src-tauri && cargo test`.
   - Backend: `cd backend && /home/jameson/.bun/bin/bun test`.
2. **Code-read the high-risk modules above** for logic bugs, missing error handling, and edge cases (empty/huge/malformed inputs, concurrency, the "no silent cloud fallback" and "no uncited answer over client data" invariants).
3. **Exercise the app** if a display is available: `npm run tauri dev`. Note: Jameson runs the desktop app on Windows over SSH, so manual UI testing may need him to drive it and report, or use the Tailscale dev URL (100.68.20.52) / the web demo. Decide the approach with him.
4. **Consider a multi-agent bug hunt** if Jameson opts in (workflows / "ultracode"): fan out finders across the feature areas, then adversarially verify each finding before fixing. Otherwise, prioritize by user impact and fix the confirmed ones.
5. **For each confirmed bug:** reproduce first, write a failing test, fix, keep the suite green, update `CHANGELOG.md`.

## Project conventions (reminders)
- TypeScript strict; `npx tsc --noEmit` is the gate. A test enforces the no-em-dash rule in user-facing strings.
- Light theme only. First-person-singular voice for any user-facing copy.
- Don't commit secrets. The repo lint baseline is large + pre-existing; `tsc` is the real gate.

## Canonical references
- Living status: `docs/strategy/2026-06-09-keepance-3.0-STATUS.md`
- Feature map: `CHANGELOG.md` `## [3.0.0]`
- Vision / north star: `docs/research/2026-06-08-ux-attorney-v2.5.1/vision-most-viable-keepance.md`
- Project memory: `~/.claude/projects/-home-jameson/memory/project_keepance_3_0.md`
