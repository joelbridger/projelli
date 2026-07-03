# Advisor Prep Hero QA Board — parallel QA control doc

**This is the shared map for accelerated, PARALLEL QA work.** Multiple isolated
agents (Claude worktree agents + Codex) work scoped tickets at the same time; one
orchestrator (the lead session) reviews, gates, and merges. Read this first
before claiming or fixing anything.

> **Bug database = [`../quality/2026-06-20-test-bug-backlog.md`](../quality/2026-06-20-test-bug-backlog.md)** (BUG-001…). That file is the *catalogue of findings*; THIS file is the *operating manual + live board* for working them in parallel. Don't duplicate the backlog here — link to BUG-IDs.

---

## 1. Commands (the pass/fail signals — one place)

| Need | Command | Speed | What it checks |
|---|---|---|---|
| Type check | `npm run typecheck` | ~10s | whole-project TS (`tsc --noEmit`) |
| Type check (tests) | `npm run typecheck:tests` | ~10s | the test tsconfig |
| Unit/integration | `npm test` | ~50s | full Vitest (3661 tests) |
| Scoped tests | `npx vitest run <path-or-pattern>` | ~1-2s | just the files you touched |
| **Lint delta (USE THIS)** | `node scripts/eslint-gate.mjs` | ~15s | **net-NEW** ESLint vs baseline (not raw `eslint .`) |
| Full pre-merge gate | `npm run gate` | ~2-3m | typecheck + i18n + vitest + ESLint + Rust cargo |
| Full + E2E + desktop | `npm run gate:full` | slow | everything (use before a release) |
| Browser E2E | `npx playwright test [spec]` | varies | Playwright (`tests/e2e/`) |
| Desktop harness | `npm run test:desktop` | slow | drives the real app (`tests/desktop/`) |
| Rust | `cd src-tauri && cargo test [filter]` | varies | the Tauri backend |

A **pre-push hook** runs the "fast gate" (typecheck + vitest) on every push, so a
broken branch can't be pushed. **A fix is not "done" until you show the command +
its pass/fail output.** (Codify in your ticket per §4.)

> Gotchas: use `node scripts/eslint-gate.mjs` not raw `eslint .` (the latter shows
> ~15 KNOWN pre-existing drift findings in App.tsx / useFileOperations / MailConnect /
> fileDrop / etc. that are NOT yours). i18n keys are kebab-case + need
> `tests/unit/i18n/en-json-snapshot.test.ts` count updates + es/de. For Codex use
> `codex-task --read-only` (NOT `codex-review` — it recurses on the AGENTS.md symlink),
> in the FOREGROUND.

---

## 2. The parallel QA engine (4 phases)

```
FIND (parallel, light) ─→ TRIAGE (lead) ─→ FIX (parallel, throttled) ─→ VERIFY+MERGE (lead, serial)
```

1. **FIND** — fan out several independent, read-only adversarial audits at once
   (Claude `Explore`/general agents + Codex `--read-only`), each on a DIFFERENT
   surface. Each returns a list of confirmed, reproducible bugs. Cheap → run many.
2. **TRIAGE** — the lead folds findings into the bug backlog (dedupe), and keeps
   only the ones fixable WITHOUT Jameson's business decisions or a real Windows/Mac
   bench (those are flagged 🔴 NEEDS-JAMESON / 🟠 NEEDS-BENCH and parked).
3. **FIX** — one isolated agent per ticket (§4). Reproduce → failing test → smallest
   root-cause fix → scoped tests green.
4. **VERIFY + MERGE** — the lead reviews each diff, runs the gate, has Codex
   sanity-check the risky ones, and merges **one branch at a time**. Never merge
   parallel branches blind.

**Bench-bug → fast test (operating rule #4).** A bug found on the real
Windows/Mac bench isn't "closed" until it has a **fast lower-layer regression
test** (Vitest / `cargo test` / Playwright) that fails without the fix and passes
with it — or is consciously tagged **EXPLORATORY** (only catchable by driving the
real app, e.g. a native OS dialog). Record it in the backlog's regression-test
table: [`../quality/2026-06-20-test-bug-backlog.md`](../quality/2026-06-20-test-bug-backlog.md)
("Bench-bug → fast regression test"). This keeps the slow Windows pass from
re-discovering the same problems.

### Concurrency caps (this box is MEMORY-TIGHT — it has OOM'd before)
- **Read-only audits (FIND):** up to ~4-6 at once (light: no builds/tests).
- **Heavy fix-agents (FIX, run tests/builds):** **cap ~2 concurrent.**
- **Verify + merge:** strictly **serial**, by the lead.
- Check `free -h` before adding load; kill any background job with no output/commits/file-changes in ~10-15 min.

---

## 3. Status legend (for the live board + backlog)

`🆕 new` → `🔵 claimed` (an agent owns it) → `🟡 in-progress` → `🟢 fixed` (tests pass on its branch) → `✅ merged` (gate green on the branch, merged) · `🔴 NEEDS-JAMESON` · `🟠 NEEDS-BENCH` (Win/Mac) · `⚪ wontfix`

---

## 4. Scoped-fix ticket protocol (every fix-agent follows this)

**One ticket per agent. No scope creep.** Drop this prompt into each fix-agent,
filling the `{...}`:

```
You are fixing ONLY {BUG-ID} from docs/quality/2026-06-20-test-bug-backlog.md.
Do NOT fix unrelated issues or refactor beyond the root cause.

1. REPRODUCE first: build the smallest fast command/test that PROVES the bug is
   real (Vitest / cargo / Playwright — NOT a 60-90min build). If you can't
   reproduce it, STOP and report that.
2. Write or update a test that FAILS because of the bug (red), then implement the
   SMALLEST root-cause fix that makes it pass (green). TDD.
3. Verify: run the scoped tests + `npm run typecheck` + `node scripts/eslint-gate.mjs`
   (your delta must be zero net-new lint). For core/data-loss code, take the ROBUST
   route, not a quick patch (Advisor Prep Hero rule).
4. Report back: the BUG-ID, the files changed, the exact verification COMMANDS you
   ran and their pass/fail output, and any residual risk. Do NOT claim done without
   that evidence. Do NOT commit/push/merge — the lead does that after review.
Constraints: light theme; i18n kebab-case + snapshot counts if you add keys;
NO build/deploy.
```

Advisor Prep Hero also has a **`ticket` skill** that encodes this "exactly one backlog
ticket, strict scope" pattern — fix-agents can invoke it.

---

## 5. Isolation + merge workflow (the lead)

- **Isolate:** parallel writers get their own git worktree (`Agent` tool
  `isolation: "worktree"`, or `claude --worktree <name>`) so edits can't collide.
  A worktree starts WITHOUT `node_modules` (gitignored) — to run tests inside one,
  symlink it: `ln -s ../keepance/node_modules <worktree>/node_modules` (or run the
  scoped tests from the main checkout after the agent returns its diff).
- **Merge serially:** for each finished branch — `git diff` review → `npm run gate`
  → Codex sanity-check if risky → merge into `keepance-3.0` → push (pre-push gate
  must pass) → mark `✅ merged` on the board. One at a time.
- Backup-tag before anything risky; never force-push / delete remote branches.

---

## 6. Live board (in-flight parallel tickets)

_Update as tickets move. Keep one row per active ticket._

| Ticket | Area | Owner (agent) | Branch | Status | Verify evidence |
|---|---|---|---|---|---|
| FIND a–e (round 4) | export / audit-log / email-store / settings / providers | 5× Codex `--read-only` | — | ✅ done | 26 findings → backlog BUG-066…091 (2026-06-22) |
| BUG-084/085/087/088 | email/SQLCipher store (Rust) | Codex (gpt-5.5) | qa/r4-mail → merge a09bddb | ✅ merged | `cargo check` + `cargo test commands::mail` 197 passed |
| BUG-071/072/073/074/075/076 | AI providers (TS) | Codex (gpt-5.5) | qa/r4-providers → merge 780b57c | ✅ merged | typecheck clean + full vitest 3675 passed; net-new lint 0 |
| bench pass 2 #10 — "Reopen last workspace" ignored | WorkspaceSelector / boot lifecycle (TS) | Claude (Sonnet 5) | fix/boot-auto-resume @ b39a3a30 | 🟢 fixed (pushed, awaiting lead merge) | typecheck clean, `lint:gate` net-new 0, 7 new hook tests + 3 new store tests green (incl. a Codex-found duplicate-reopen regression test), full pre-push vitest 5208/5214 passed; 2 clean Codex review rounds |

**Round-4 queued (not yet dispatched — cap ~2 heavy):** audit cluster (BUG-077/079/080/081/082/069/068), export-scrub cluster (BUG-066/067, Rust), settings cluster (BUG-089/090/091), BUG-070 (Assured stream flag); TEST-001..005. **🔴 flagged for a focused effort:** BUG-078 (audit hash-chain — schema migration + scope confirm), BUG-083 (MCP read/search audit — fold into OPEN BUG-038/039).

**Live Windows bench pass (2026-06-22, real Legion, Advisor Prep HeroTest workspace):** app healthy + renders correctly (light theme; egress indicator = "Sent to your OpenAI account" → BUG-001 holding). **BUG-081 live-confirmed** — AI redline logs a `Model Call` but NO "AI Request Sent" (egress) row, while chat logs both. **BUG-080 signal** — a workflow generating live produced no new Activity Log entry (newest = Jun 20). Email/privilege/file-to-matter flows render correctly.

---

## 7. Test-coverage map + gap-tickets

**Audited 2026-06-22.** Reality check: Advisor Prep Hero is ALREADY heavily tested
(3661 vitest + 40+ Playwright E2E with traces/video-on-failure + a desktop
harness driving the real app + Rust crate tests + backend bun tests). The guide
assumed an under-tested app — that's not us. Coverage is solid at the
unit/logic/Rust layer across all 10 critical flows; the real gaps are a handful
of **end-to-end** journeys. Each gap below is a `TEST-xxx` ticket the parallel
engine can fill.

| Critical flow | Depth | Strongest test |
|---|---|---|
| Workspace open/create | solid (svc) / thin (OS picker) | `tests/integration/workspace.test.ts`, desktop `00-workspace-shell` |
| Matter create/archive/delete + isolation | solid (unit) / partial (E2E delete chain) | `tests/unit/matter/matter-delete-rag-purge.test.ts`, `matter-scope-guard` |
| Ask-my-workspace + citation trust (BUG-065) | **solid** | `tests/unit/rag/citation-grounding-strict.test.ts`, desktop `18-rag-cited-ask` |
| Email import/search/file | partial (logic solid, real import unautomated) | `tests/unit/mail/*`, `src-tauri/tests/mail_e2e.rs` |
| .docx edit/autosave/redline | solid (Rust OOXML) / partial (autosave→disk) | `src-tauri/crates/keepance-docx/tests/roundtrip.rs` |
| AI file tools + batch review + Trash | solid (logic) / partial (full batch UI) | `tests/unit/ai/*`, `tests/unit/history/trash-file.test.ts` |
| Encrypted vault enable/recover | **solid** (best-covered) | desktop `12-vault`, `keepance-vault/tests/destructive.rs` |
| Firm SSO + co-edit CRDT | solid (math/crypto) / partial (2-session converge) | `tests/unit/coedit/convergence.test.ts`, backend `sso-flow` |
| Export/share + redaction | **thin** | `tests/unit/export-pipeline.test.ts` (format selection only) |
| Privacy/egress/Local-only | solid (logic) / partial (live-UI enforce) | `tests/unit/privacy/local-only-egress-guard.test.ts` |

### Gap-tickets (highest-value missing E2E/integration — fill via the engine)
- **TEST-001 (high):** Matter delete → verified RAG purge, end-to-end (create matter → index a doc → delete matter → Ask-my-workspace → assert the deleted matter's content is NOT cited). Guards the BUG-040 isolation guarantee, only unit-tested today.
- **TEST-002 (high):** Real email import → filing → search (fixture-based: seed the SQLCipher mail store → assert it appears in the Email tab, AI search surfaces it, "file to matter" assigns it). The L3 live harness is missing.
- **TEST-003 (med):** Autosave loop — type in DocxEditor → wait 2s → read the backing file from disk → assert it has the typed content (today only the *indicator* is tested, not the write).
- **TEST-004 (med):** Vault escrow recovery end-to-end (provision escrow wraps → delete VMK → recover via admin-escrowed key, no recovery phrase). Zero E2E coverage.
- **TEST-005 (med):** Local-only mode enforcement in the LIVE UI (set Local-only → cloud-backed chat → assert send routes to Ollama or surfaces a blocking error). The guard is unit-tested but not exercised through the rendered UI.

---

## 8. Post-edit lint hook (fast feedback)

`scripts/post-edit-lint.sh` runs `eslint` on **only the just-edited .ts/.tsx file**
(~2-3s, non-blocking, quiet on success) so lint issues surface at edit time. It's
wired in `.claude/settings.json` (`hooks.PostToolUse`, matcher `Edit|Write|MultiEdit`)
— note that file is gitignored (local), so the SCRIPT is the committed/shared part
and each machine opts in via its settings. A whole-project typecheck/eslint per
edit is deliberately NOT used (too slow on this repo); the authoritative gate stays
`npm run gate` + the pre-push hook. Disable by removing the `hooks` block.

## Round-4 completion (2026-06-22)

**ALL round-4 waves MERGED + pushed to keepance-3.0.** 24 of 26 found bugs (BUG-066..091) + all 5 TEST gap-tickets fixed/verified/merged; only BUG-078 (audit hash-chain) and BUG-083 (MCP audit, folds into BUG-038/039) deferred pending a scope check. Final gate on the merged branch: typecheck clean · full vitest 3702 passed/0 failed · full cargo 559 passed/0 failed. See the bug DB for per-ticket detail. NO build/deploy cut.
