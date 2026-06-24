# How we test Keepance (method overview)

**Audience:** an AI/engineer helping us make this testing loop faster and more
efficient. This is a candid, end-to-end description of how we currently test the
Keepance desktop app — including the slow parts. It is deliberately specific about
mechanics and friction so you can find leverage. Written 2026-06-24.

**TL;DR of the philosophy:** Keepance is a local-first **desktop** app (Tauri =
Rust backend + a WebView2 UI running React/TypeScript). Unit tests alone never catch
the real bugs — the important failures only show up when you *drive the actual built
app on real Windows like a user would*. So our highest-value testing is **AI-driven,
real-OS, end-to-end**: we remote-control the live app on a Windows laptop over a
debugging protocol, observe it, and document/fix what breaks. Unit/integration tests
and the pre-merge "gate" are the fast safety net underneath that.

---

## 1. The two layers of testing

| Layer | What it is | Speed | Catches |
|---|---|---|---|
| **A. Automated gate** (`npm run gate`) | TypeScript typecheck + i18n check + ~4000 Vitest unit/integration tests + ESLint + Rust `cargo test` | Minutes | Regressions, type errors, logic bugs with coverage |
| **B. Real-OS app driving** (the focus of this doc) | Remote-control the built app on real Windows, drive every screen like a user, observe + screenshot | Slow, mostly serial | The bugs that only appear in the real app: indexing, AI calls, rendering, native dialogs, OS file paths |

Most "is the demo actually good?" testing is **Layer B**. Layer A is the gate every
code change must pass before merge.

Related existing docs (context, not duplicated here):
- `docs/operations/2026-06-24-northcrest-windows-demo-playbook.md` — the demo setup + how to drive the Windows bench.
- `docs/operations/2026-06-24-northcrest-demo-bug-log.md` — the live bug log (findings + fixes).
- `docs/operations/2026-06-19-test-bench-operations-guide.md` + `2026-06-19-ai-dev-velocity-strategy.md` — bench ops + the "two speeds" velocity strategy.
- `docs/qa/QA_BOARD.md` — the parallel QA control doc (worktree agents + Codex on scoped tickets).
- `docs/quality/2026-06-19-pre-release-master-test-plan.md`, `2026-06-20-windows-desktop-test-plan.md` — structured test plans.

---

## 2. The environment (what "real Windows" means here)

- **The bench:** an always-on Windows 10 laptop ("the Legion"), reachable from our
  Linux server over a Tailscale VPN as `james@100.127.67.22` (SSH). All driving
  happens from the server via SSH to this laptop.
- **Why a real laptop:** the app uses Windows-only pieces (WebView2 webview, native
  file dialogs, OS keychain, Windows file paths with `\`). Linux/CI cannot reproduce
  those. A Mac bench exists for Mac spot-checks the same way.
- **How the app runs on the bench (3 modes):**
  1. **Signed installer build** — the real shipping artifact. Most faithful but a
     full build takes ~60–90 min, so we do NOT use it as the iteration loop.
  2. **"Preview" mode (what we actually use)** — serve the *built* frontend bundle
     with `vite preview` and run the already-compiled debug binary against it. This
     behaves like production (no dev server to crash; AI calls go directly to the
     provider) but is reachable in seconds, not an hour. This is the default test mode.
  3. **Dev mode (`tauri:dev`)** — avoided on this bench: its dev server keeps
     crashing on the WebView2 box and silently breaks PDF indexing + AI calls.
- **The remote-control channel:** the WebView2 UI exposes the **Chrome DevTools
  Protocol (CDP)** on a local port (`127.0.0.1:9223`). We connect to it with
  Playwright to read the DOM, click by stable `data-testid`s, type, screenshot, and
  even call the app's own backend commands. A separate small Python agent
  (`pyautogui`, reachable via an HTTP port on the laptop) handles **native OS dialogs**
  (the folder picker, save dialogs) that CDP cannot touch.
- **The test data:** a fabricated-but-realistic financial-advisory firm, "Northcrest
  Wealth Partners" — 374 files (statements, tax returns, plans, meeting notes, emails,
  estate docs, 3 scanned/OCR PDFs), 26 client households, 6 of them "deep." This is
  the corpus we point the app at. (Generated deterministically from
  `~/keepance-demo-data/`.)

---

## 3. The end-to-end loop, each time we're asked to test

A full pass is four phases. Phases 1–2 are the "is it good?" exploration; 3–4 are the
fix + prove-it.

### Phase 0 — Bench up & reachable (minutes)
- Confirm the laptop is online (Tailscale), the app process is running, and the two
  ports are listening (CDP `9223`, preview `5173`). If the code changed, sync the new
  frontend/Rust to the bench and restart. (Frontend change = rebuild the bundle;
  Rust change = stop app, `cargo build`, restart — the running `.exe` locks the binary.)

### Phase 1 — CLEAN SLATE (critical; recently added) ⭐
**Rule:** never test on top of state left over from earlier runs — it loads old data
and skews results. (We learned this the hard way: a "client summary" looked like it
had 128 duplicated facts, but ~1 MB of that was accumulated test residue; a truly
clean build was a clean 35 facts.)
- We wipe the app's local browser storage residue (old AI summaries, old Q&A history,
  stale workspace entries) **and** delete the workspace's on-disk search index, so the
  app re-reads everything from scratch — exactly like a brand-new user.
- **Gotcha that matters for efficiency:** the WebView2 storage flushes to disk
  *asynchronously*, so clearing it in-app and then force-killing the process loses the
  clear (old state reloads). Two reliable wipes: (a) delete the WebView2 "Local
  Storage" folder on disk while the app is stopped, or (b) clear the keys in-app then
  `location.reload()` *without* killing the app. The OpenAI API key also lives in this
  storage, so a full wipe must re-seed it.
- Tooling: `scripts/demo/legion-clean-reset.sh` (one-command reset) and
  `legion-purge-residue.mjs` (surgical, durable, no-restart wipe).

### Phase 2 — SWEEP: drive every surface, document only (fix nothing)
We open the app like a real advisor and walk **every** screen, logging every bug and
rough edge before changing any code. Surfaces covered:
- First-run/onboarding (welcome → open folder → **auto-import** → first client map)
- Auto-import itself (does opening a folder auto-tag clients + auto-index PDFs/OCR with
  visible progress?)
- A client's hub / "at a glance" / **Client Map** (auto-built profile: build quality,
  citations, edit, the "updates to review" tray)
- **Ask / Search** (cited answers, follow-ups, streaming, error states, scopes)
- **Client isolation** (one client's data must never surface in another's results)
- Settings, Privacy Center, Activity Log, Workflows, Email connect, Trash, the
  data-egress indicator, empty/loading/error states, and light-theme consistency.
- Sparse vs deep clients (do thin clients build awkward/empty maps?)

For each finding we record: **severity** (blocker / major / minor), a one-line
**symptom**, the **root cause**, and a **file pointer** — into the dated bug log.

**How we actually "see" each screen:**
- `scripts/legion-drive.sh {snapshot|click|type|eval|screenshot|waitfor}` — drives the
  app by `data-testid` over CDP (runs Playwright *on the laptop* against `:9223`).
- For anything non-trivial we write a small `.mjs` Playwright script, copy it to the
  laptop, and run it there (PowerShell mangles inline JS passed over SSH).
- We read app **state directly** when the screen is hard to read: e.g. a probe that
  dumps the persisted Client Map JSON to count facts/duplicates/citation pages, or one
  that asks a question and reports whether the answer got verified citations. This is
  far more reliable than screen-scraping.
- We pull screenshots back to the server and visually review them.

### Phase 3 — FIX: parallel, isolated agents
- Cluster the findings into **non-overlapping file groups** (e.g. "Ask citations",
  "Client Map quality", "labels", "email/polish", "audit logging").
- Launch one **Codex** agent per cluster (a second, independent AI engineer), each in
  its own **git worktree** (isolated branch + working copy) so they can edit in
  parallel without colliding. Each gets a precise task packet: the diagnosed root
  cause, the exact files, hard constraints, and acceptance criteria.
- **Concurrency rule:** TypeScript-only agents fan out freely (they're network-bound,
  ~50–60 MB each locally); only **one** agent may compile Rust at a time (cargo's build
  lock serializes them, and a blocked one self-aborts).
- TS agents validate with `npm run typecheck` + scoped unit tests; the one Rust agent
  runs the full `npm run gate`.

### Phase 4 — VERIFY: review, merge, gate, re-prove on Windows
- We read each agent's diff (treat its output as a proposal), reconcile + merge each
  branch back to the main working branch (`keepance-3.0`), resolve conflicts.
- Run the **full `npm run gate`** green on the merged result.
- **Re-verify the fixes on real Windows** (back to Phase 1 clean slate + drive the
  specific fixed surfaces) — evidence before claiming done. A fix isn't "done" until we
  show the command we ran and its pass/fail output, and confirm it live.

---

## 4. The toolbox (scripts), at a glance

All under `scripts/` and `scripts/demo/` in the repo:
- `legion-drive.sh` + `desktop-drive.mjs` — the generic CDP driver (snapshot/click/type/eval/screenshot/waitfor).
- `legion_agent.py` — pyautogui agent on the laptop for native OS dialogs.
- `legion-clean-reset.sh`, `legion-reset.mjs`, `legion-purge-residue.mjs` — clean-slate.
- `legion-seed.mjs` — lay down the demo seed (advisor mode, settings, 26 clients, recent workspace).
- `legion-idxmon.mjs` — watch the indexing progress banner through its phases.
- `legion-cmprobe.mjs` — dump a Client Map's section counts, near-dupes, citation-page distribution.
- `legion-askcheck.mjs` — ask one question, report whether the answer got verified citations.
- `legion-buildone.mjs` — build one client's map via the real UI flow and report the result.
- `legion-sweep.mjs` / `legion-sweep2.mjs` / `legion-light.mjs` — navigate + screenshot batches of surfaces in one CDP session.
- `legion-verify.mjs` — per-client scoped retrieval + cross-client isolation check (leak = 0).

---

## 5. Known friction / where efficiency is on the table

This is the part most useful to an efficiency reviewer. Current bottlenecks:

1. **SSH round-trip latency + serial driving.** Every action (click, screenshot, probe)
   is a fresh SSH call to the laptop; they run mostly one at a time. A sweep of ~15
   surfaces is dozens of serial round-trips. Batching multiple actions into one CDP
   session per script helps but isn't consistently applied.
2. **No fast "see my change in the real app" loop.** Frontend changes need a bundle
   rebuild + restart; Rust changes need stop → `cargo build` → restart (the running
   exe locks the binary). The signed installer build is ~60–90 min and avoided. The
   gap between "edited code" and "saw it work on Windows" is minutes at best.
3. **Clean-slate is fiddly.** The async storage-flush race (above) makes a reliable
   wipe non-obvious; the recent-workspaces list and audit DB persist in places a
   storage wipe misses. A single robust, fast "factory reset to known demo state"
   primitive would remove a whole class of mistakes.
4. **Screen reading is awkward.** The DOM snapshot caps at 250 nodes (a bloated screen
   overflows it), inline JS over SSH/PowerShell gets mangled (forces writing+copying a
   `.mjs` each time), and multi-word `type` over SSH word-splits. We lean on
   state-dump probes instead of the UI, which is reliable but bespoke per question.
5. **Visual review is manual.** Screenshots are pulled back and eyeballed one by one;
   no automated visual diff/regression baseline for the real app.
6. **Indexing is slow and serial in the loop.** A clean re-import re-reads 374 files
   incl. 301 PDFs + OCR; we poll a progress banner to know when it's done before we can
   test the dependent surfaces.
7. **AI-dependent surfaces are nondeterministic + cost real tokens.** Ask answers and
   Client Map builds call a live model, so results vary run to run and aren't free;
   there's no record/replay or fixture mode for the model in the real-app loop.
8. **Findings → fixes is well-structured but hand-built each time.** Clustering,
   worktree creation, agent task-packets, and merge are done manually per pass.

Ideas worth exploring (for the efficiency AI to weigh): a persistent CDP session/daemon
to kill round-trip latency; a single reliable "reset to seeded demo state" command; a
hot-reload-capable preview that survives on this WebView2 box; a model record/replay or
deterministic fixture mode for AI surfaces; an automated visual-diff baseline; and a
standing harness that turns a bug-log into worktrees+agent-packets automatically.

---

## 6. Hard constraints that shape testing (don't "optimize" these away)
- **`matter_id` is the security isolation key** — the Rust layer hard-filters retrieval
  by it. Never rename `matter` / `matter_id` / related keys; client-to-client isolation
  (leak = 0) is a mandatory test, not a nicety.
- **No shortcuts on the core app** — fixes must be robust, not quick patches.
- **Light theme only; no em dashes in user-facing copy.**
- **Real-OS testing is the AI's job, not the human's** — we drive the Windows bench
  ourselves; we never ask the human to install/run/smoke-test the app.
- **Communication to the human (Jameson) is plain-language** (he's a product designer,
  not an engineer); this doc is the exception because its audience is technical.
