# F-301 Memory Leak Investigation — Advisor Prep Hero 3.0 desktop (Linux, Tauri 2 / webkit2gtk)

**Started:** 2026-06-10 ~12:35 UTC. Investigator: leak-debug agent (systematic-debugging discipline).
**Bug:** compiled desktop app leaked to ~24 GB anon-rss (total-vm 113 GB), kernel OOM-killed PID 1942633 at 08:05 UTC; a second runaway froze the host ~12:09–12:15 (hard power cycle).
**Safety posture for all experiments:** app only ever launched inside `systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0`, plus an RSS watchdog sampling every 5 s that kill -9s the tree at 2.5 GB. Xvfb :99. `free -h` checked between experiments (stop if available < 5 GB).

---

## Incident timeline (reconstructed from forensics)

| Time (UTC) | Event | Evidence |
|---|---|---|
| ~07:40 | Native-pass run 1 launches debug app (fresh profile, wizard) | screenshots/native/01-initial-launch.png mtime 07:41 |
| 07:41–07:47 | Run 1 completes wizard, opens workspace, creates docx | screenshots 01–16 mtimes |
| 08:05 | Kernel OOM-kills `keepance` PID 1942633: **anon-rss 23,967,236 kB (~24 GB), total-vm 113 GB** | journalctl -b -1 -k (incident doc) |
| 12:01 | Run 2 launches (fresh profile, reached wizard step 2) | run2-* screenshot mtimes |
| 12:02–12:03 | Run 3 launches (recent workspace, docx, upload) | run3-* screenshot mtimes |
| ~12:09–12:15 | Second runaway exhausts memory; host thrash-freezes; hard power cycle | journal stops 12:15:21; all services restart 12:16 |

Growth rates implied: run 1 ≈ 24 GB in ≤25 min (**~1 GB/min**); second window ≈ exhaustion in 6–8 min from launch (faster).

## Environmental observation made before any experiment (12:34 UTC)

The debug binary's webview loads `devUrl http://localhost:5173` (src-tauri/tauri.conf.json:8) — the shared Vite dev server other campaign agents use. `/tmp/keepance-dev.log` shows Vite issuing **full `page reload` events ~19/min** (205 events 12:21:34→12:32:26) because campaign agents continuously write Playwright artifacts/reports/markdown inside the repo, and Vite broadcasts a full-page reload to every connected client for each out-of-module-graph file change. Any connected Tauri webview was therefore being force-reloaded every ~3 s during both incident windows.

**Hypothesis ladder (to be tested, not assumed):**
- H1: each forced devUrl page reload leaks memory (main `keepance` process — Rust side per-reload allocations with no teardown; kernel attributed the 24 GB to comm `keepance`, not WebKitWebProcess).
- H2: idle leak on first-run/wizard surface (effect/render loop) independent of reloads.
- H3: autosave interval / dirty-state loop (App.tsx:2846).
- H4: RAG/embedding re-index loop (useMemoryWiring) after workspace open.
- H5: Rust-side unbounded buffer (mail sync, vector store, audit, docx engine).

## Experiments

(appended incrementally below)
### Experiment A + B — idle on FirstRunWizard, with ambient + forced devUrl reloads (12:36–12:41 UTC)

Setup: fresh XDG profile (/tmp/kp-leak-expA), `systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 --unit=leakexp-A` (verified MemoryMax=3221225472 on the cgroup), Xvfb :99, watchdog sampling all scope PIDs every 5 s to /tmp/leak-rss.csv. Processes in scope: `keepance` (190532), `WebKitNetworkProcess` (190547), `WebKitWebProcess` (190551) — webkit2gtk-4.1 runs web content out-of-process here.

Result over 211 s spanning **19 Vite full-page-reload events** (counter 227→246, ambient from other campaign agents' artifact writes, plus one forced ctrl+R):

| t | keepance RSS kB | WebKitWebProcess RSS kB | cum. reloads |
|---|---|---|---|
| 0s | 238,284 | 328,604 | 227 |
| 91s | 238,288 | 328,532 | 229 |
| 106s | 238,448 | 334,104 | 235 |
| 181s | 238,508 | 362,708 | 238 |
| 211s | 238,316 | 337,216 | 246 |

**Conclusion: NO leak on the wizard/selector surface.** Main process flat (±0.2 MB over 19 reloads — slope ~0 MB/min); web process shows transient reload churn fully recovered by GC. H1 (reload leak) and H2 (wizard idle loop) falsified *for this surface*. Both incident instances had an open workspace on the fixture corpus when they ballooned → proceed to Experiment C (workspace open + idle).

### Experiment C — workspace OPEN (fixture corpus) + idle, then forced devUrl reload storm (12:48–12:52 UTC)

Setup: same capped scope (`leakexp-C`, MemoryMax verified 3221225472) and watchdog (/tmp/leak-rss-C.csv). Bypassed the unreliable headless GTK picker by seeding `keepance_recent_workspaces` into the webview localStorage (UTF-16-LE BLOB) pointing at `/tmp/wsleak` (full fixture matter-corpus incl. the 2 MB huge-notes.md). Clicked the recent entry → `handleOpenRecentProject` → workspace opened, file tree + RAG wiring (`useMemoryWiring`: `watch_workspace` + background `rag_index_workspace`) + FileSystemWatcher (3 s poll) + 2 s autosave interval all live. Dismissed the 10-step tour.

Idle (≈90 s): keepance 207→276 MB (one-time startup+load ramp), then **plateau ~276 MB**; WebKitWebProcess settled ~370 MB. Reload counter frozen (ambient reloads paused). No runaway.

Forced reload storm: touched a repo-watched file 24× over 72 s → Vite broadcast ~29 full-page reloads to the webview (counter 345→381):

| metric | start | after 29 reloads |
|---|---|---|
| keepance RSS | 276 MB | **281–286 MB (flat, GC-oscillating)** |
| WebKitWebProcess RSS | 370 MB | 389–445 MB (GC churn, non-monotonic) |

**Conclusion: NO runaway from reloads even with a fully-wired open workspace.** keepance main process is rock-stable at ~283 MB ±3 MB across 29 hard reloads; webkit only GC-churns. H1 finally falsified under the strongest condition. The incident's 24 GB landed on comm `keepance` (the main process) while the JS heap lives in the *separate* WebKitWebProcess — so the leak is NOT JS-heap and NOT reload-driven. The element common to BOTH incident runs that I have NOT yet reproduced is **a .docx open in the editor** (run 1 created+typed+saved+reopened a docx; run 3 reopened a docx + tracked changes). Next: Experiment D — open the fixture docx and idle, watching the main process.

### Experiment D — workspace open + sustained file-churn driving the watcher→indexFile→open_connection loop (12:58–13:04 UTC)

Setup: scope `leakexp-D` (MemoryMax verified 3 GB), fresh profile/workspace `/tmp/wsleakD` (fixture corpus copy), seeded recent + onboarding-complete. Opened workspace via recent click, dismissed tour. Then a shell loop appended a line to an *indexable* workspace file (`incident-summary-johnson.md`) every 1 s for ~150 s. Confirmed this drives the real path: Rust `watch_workspace` emits `workspace-file-changed` → `useMemoryWiring` listener → `MemoryService.indexFile` → `invoke('rag_index_file')` → `store::open_connection` opens a **fresh LanceDB connection every call** (store.rs:256, no cache/pool). App log showed live `lance::io::commit` activity, confirming re-indexing fired ~1/s.

| phase | keepance RSS |
|---|---|
| workspace just opened | 281 MB |
| during churn (steady) | **338 MB, flat across 6+ samples (338,176–338,404 kB)** |

**Conclusion: the indexFile / fresh-connection-per-call loop does NOT leak.** One-time +57 MB working-set bump, then a hard plateau at 338 MB under ~1 re-index/s — *faster* than the incident's 0.5/s docx autosave. So `open_connection`-per-index is not the 24 GB driver (LanceDB/Rust frees the per-call connection). H4 (RAG re-index loop) and the watcher-feedback theory are falsified.

**State of play after A–D:** every "background loop" hypothesis is flat. The incident's distinguishing factors are (1) it was the *native GUI automation* specifically, and (2) total-vm reached **113 GB** with 24 GB RSS — a 5:1 virtual:resident ratio that signals tens of thousands of threads or huge mmap reservations, i.e. a *per-instance native resource* created in a loop. During my own setup I directly observed **orphaned "Select Workspace Folder" GTK windows accumulating** on the no-WM Xvfb: a Vite full-reload tears down the webview but a native GTK file-chooser dialog opened from it is NOT destroyed (separate native window owned by the GTK main loop). Each orphaned chooser holds GIO file monitors + directory enumeration + widget tree (+ helper threads). Next: Experiment E — open file choosers and orphan them via reloads, measure keepance per orphaned chooser.

### Experiment E — REPRODUCTION: concurrent/rapid `indexWorkspace()` with no concurrency guard (13:09–13:10 UTC)

Hypothesis: the incident's resident runaway comes from *piled-up concurrent full-corpus indexers*. `rag_index_workspace` (Rust, mod.rs:307) has NO concurrency guard (it even sets `cancel_flag=false` at entry, un-cancelling any prior run), `MemoryService.indexWorkspace` (MemoryService.ts:189) has no dedup, and `useMemoryWiring` fires `indexWorkspace()` on every workspace open (useMemoryWiring.ts:300). The dev Vite reload storm (other campaign agents writing repo artifacts → HMR full-reload of the shared :5173) repeatedly reset the Tauri webview to the workspace selector; the native automation re-opened the workspace; each open spawned another concurrent indexer.

Method (temporary instrumentation, since reverted): localStorage-gated storm in `useMemoryWiring` firing `indexWorkspace()` every 400 ms on workspace open — a faithful stand-in for "indexWorkspace re-fired faster than it completes." Same 3 GB cap + watchdog. Profile `/tmp/kp-leak-expE`, workspace `/tmp/wsleakE` (fixture corpus incl. 2 MB huge-notes.md). App log went 28 → **2399** lines of concurrent `lance`/`commit` activity, confirming overlapping full-corpus indexers.

keepance RSS curve (watchdog /tmp/leak-rss-E.csv):

| t | keepance RSS |
|---|---|
| 0 s | 212 MB |
| 5–25 s | 233 MB (one indexer running, flat) |
| 30 s | 302 MB |
| 35 s | **1436 MB** |
| ~37 s | **cgroup-OOM-killed at the 3 GB MemoryMax** |

journal: `leakexp-E.scope: A process of this unit has been killed by the OOM killer … Failed with result 'oom-kill'`. Host stayed at 13 GB free — the cap contained it perfectly.

**This reproduces the incident signature:** a flat baseline, then an *accelerating* resident-memory runaway (233 MB → 1.4 GB → 3 GB in ~10 s once concurrency builds), driven by overlapping `rag_index_workspace` runs that never coalesce. Each concurrent run opens its own fresh LanceDB connection (store.rs:256, no pooling → each reserves a ~10 GB virtual arena, which is why I measured **VmSize 73 GB at only 338 MB RSS** in exp D — explaining the incident's total-vm 113 GB) and holds the corpus's chunk+embedding buffers; resident climbs with concurrency until OOM. The incident's slower ramp (minutes) vs my 35 s reflects re-open cadence: reloads+re-opens every few seconds vs my 400 ms storm.

## ROOT CAUSE

`rag_index_workspace` is an expensive, memory-heavy, externally-re-triggerable operation with **no concurrency guard**, and its callers (`useMemoryWiring` → `MemoryService.indexWorkspace`) re-fire it on every workspace open with no dedup. When opens repeat faster than a full index completes (in the incident: dev Vite reload-storm resets → native automation re-opens; generally: any rapid re-open / workspace-switch), concurrent full-corpus indexers pile up. Each holds a fresh un-pooled LanceDB connection (large virtual arena) plus embedding buffers; aggregate resident memory runs away unbounded → kernel OOM. Evidence: exps A–D (single indexer, idle, reloads, serial indexFile churn) all plateau ≤340 MB; exp E (concurrent indexWorkspace) runs away to the 3 GB cap in ~35 s.

## FIX (planned)

Add a concurrency guard to the owning allocation: `rag_index_workspace` coalesces — if a full-workspace index is already running for the app, a new call returns immediately (no second walk). Defense-in-depth: `MemoryService.indexWorkspace` also drops overlapping calls. Regression test: the guard rejects/*coalesces* a second concurrent invocation. (open_connection-per-call pooling is a noted secondary inefficiency, not the leak — serial connections plateau.)

---

## CORRECTION (the F-301 first fix attempt was falsified — full root cause below)

Experiment E's "concurrent pile-up" reading was INCOMPLETE. A concurrency guard alone did NOT stop the runaway (exp F). Deeper instrumentation (acquire/release/migration logging + capturing the panic) revealed the true mechanism.

### Experiments F–H (fixed builds, instrumented) — what actually happens

- **exp F (concurrency guard only):** still ran away to 1.4 GB→OOM. Acquire/release logs proved the storm's `rag_index_workspace` calls run **sequentially, not concurrently** (each completes before the next acquires; `coalesced=0`). So a concurrency guard never triggers.
- **The repeated work:** each call logged `rag: migrating pre-3.0 vector store` — **15 migrations in 6 s.** The `.index_version` marker was NEVER written, so `needs_migration` returns true on every call → every `rag_index_workspace` re-runs the destructive **`drop_table` + full re-index**.
- **Why the marker is never written + the leak owner (exp F4, captured the panic):**
  ```
  thread 'tokio-runtime-worker' panicked at lance-0.33.0/src/dataset.rs:496:43:
  range end index 4280287564 out of range for slice of length 744
  ```
  **372 panics.** The rapid `drop_table`+recreate churn corrupts the per-workspace LanceDB dataset; reads then interpret garbage bytes as a slice length and panic. The panic aborts the walk via `?` **before** `write_index_version`, so the marker never persists → next call re-migrates → re-corrupts → panics again. The repeated panic-unwinds + drop/recreate churn are what leak resident memory to the OOM. (This also explains the incident's total-vm 113 GB: each fresh un-pooled `open_connection` reserves a ~10 GB virtual arena; measured VmSize 73 GB at 338 MB RSS in exp D.)

### TRUE ROOT CAUSE

`rag_index_workspace`'s **default full walk is fired on every workspace open** (`useMemoryWiring` → `MemoryService.indexWorkspace`), and `rag_set_workspace` (also called on every open) re-armed indexing each time. The dev Vite HMR **reload-storm** (parallel campaign agents writing repo artifacts into the watched tree → full-page reload of the shared :5173 webview) reset the app to the workspace selector every few seconds; the native automation re-opened the **same** workspace repeatedly; each re-open re-fired the full walk. Because the version marker only writes at the END of a *successful* walk, every re-fire re-ran the destructive pre-3.0 migration (`drop_table` + rebuild); the rapid drop/recreate churn **corrupted the LanceDB dataset and triggered a flood of `lance dataset.rs:496` panics whose unwinds leaked memory until the kernel OOM-killed the process (~24 GB / total-vm 113 GB).** Falsification ladder: idle (A), reloads-only (B/C), serial single-file indexFile churn (D) all PLATEAU ≤340 MB; only *repeated full-workspace re-index* runs away.

### THE FIX (src-tauri/src/commands/rag/mod.rs + store path-change gate)

Three coordinated guards, all in the Rust owner:
1. **Re-arm only on real change** — `rag_set_workspace` arms the full-index latch **only when the workspace root actually changes**. `RagState` lives in the Rust process and survives webview reloads, so re-opening the SAME workspace (every reload/HMR re-mount) is a no-op for indexing. *This is the load-bearing fix:* it collapses the reload-storm's dozens of re-fires to zero.
2. **Once per activation** — the default walk (`matter_id == None`) consumes a latch (`full_index_pending`, armed by guard 1) via an atomic `true→false` swap; later default calls for the same activation return immediately.
3. **Concurrency guard** — an `indexing` flag (RAII-released on every exit incl. panic-unwind) ensures two walks never mutate the same dataset at once (covers a slow walk on a large workspace overlapping a genuine workspace switch) — preventing the corruption that caused the panics.

Incremental edits remain covered by the file-watcher → `indexFile` (idempotent upsert, proven flat in exp D). Frontend defense-in-depth: `MemoryService.indexWorkspace` also drops overlapping default calls (`workspaceIndexInFlight`).

### VERIFICATION (exp H — fixed binary, SAME storm as the repro)

| build | storm | keepance RSS | migrations | panics | outcome |
|---|---|---|---|---|---|
| pre-fix (exp E/F) | on | 233 → 1436 → **OOM-killed @3 GB in ~35 s** | 15 | 372 | host-OOM signature reproduced |
| **fixed (exp H)** | on (identical) | **flat 211 → 275 MB, ±3 MB for 95 s+** | **0** | **0** | **app survives; plateau** |

RSS curve (fixed, exp H): 0s 211 MB · 20s 269 · 45s 269 · 70s 275 · 95s 275 — flat through the entire 60 s storm and beyond. The single clean walk wrote the `.index_version` marker; no re-migration, no corruption, no panic.

Tests: `cargo test --lib commands::rag` = **74 passed** (incl. 5 new: `reopening_same_workspace_does_not_rearm`, `full_index_runs_once_per_activation`, `re_activation_re_arms_the_latch`, `concurrent_default_walks_only_one_wins`, `concurrency_guard_blocks_overlap_and_releases_on_exit`). `npx tsc --noEmit` clean. `npx vitest run tests/unit` = **2518 passed**.

Sanity (exp I — normal open, no storm): app stable, RSS flat ~314 MB, **0 panics, no runaway**. (Full index completion is gated on the embedder model download — the e5-small ONNX model is NOT bundled, only a `.gitkeep` placeholder ships in `src-tauri/resources/embeddings/`; a throwaway profile has no cached model so the first index waits on a HuggingFace download. This is pre-existing and orthogonal to the fix — the fix only adds guard early-returns and never touches the embed/index path. NOTE filed below.)

### Follow-ups discovered (not the leak; worth tickets)
- **Embedder model not bundled:** `src-tauri/resources/embeddings/` ships only `.gitkeep`, so first-run indexing depends on a HuggingFace download (offline/first-run UX gap; `resolve_cache_dir` already prefers a bundled copy if present).
- **LanceDB panic robustness:** `lance 0.33 dataset.rs:496` can panic on a concurrently-mutated/corrupted dataset; consider wrapping store opens in `catch_unwind` or upgrading lance, as defense-in-depth beyond preventing the concurrent access.
- **`open_connection` per call is un-pooled** (store.rs:256) — each reserves a large virtual arena; pooling one connection per workspace would cut the 73 GB virtual footprint. Not the leak (serial connections plateau) but wasteful.
