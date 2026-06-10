# F-301 Memory Leak Investigation — Keepance 3.0 desktop (Linux, Tauri 2 / webkit2gtk)

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
