# swallow-p0 (QA-44) LIVE remap-restart check — Azure cloud bench

- **Bench:** lantern-cloud-bench-1 (Azure, Tailscale 100.75.247.98), driven over WebView2 CDP (port 9223 → local 9444).
- **Branch/build:** `lp/swallow-p0` @ `6fdcc5ed`, rebuilt on the VM (full Rust rebuild, 8m58s; app relaunched, CDP live).
- **Workspace:** "Beacon Ridge Demo" (`C:/Users/james/Documents/Beacon Ridge Demo`) — real, indexed, 3 clients.
- **Under test:** re-map folder **F = "The Hendersons"** from **client A = Hendersons** (`matter_880a5033…`) to **client B = Alvarez** (`matter_d31ac868…`).
- **Probe method (honest product path):** each check reads retrieval two ways and compares:
  - `raw` = Rust `rag_retrieve` (physical index tags, BYPASSES the fail-closed layer)
  - `ms`  = `MemoryService.retrieve` (the REAL product path — dynamic-imported singleton with the live fail-closed exclusion predicate installed by `useMemoryWiring`)
  - `F` = count of retrieved hits whose path is directly under the Hendersons folder (excludes the `/Meetings/` transcript subtree).
  - A hold is proven when `ms` withholds F (`ms.F=0`) while `raw` still shows it physically (`raw.F>0`).

## Baseline (no remap yet)
```
raw_A F=2, raw_B F=0, ms_A F=2, ms_B F=0
A_folderPaths=[.../The Hendersons], B_folderPaths=[.../Maria & Luis Alvarez]
banner=null, durableHold=null
```
Interpretation: F is retrievable only under A; MemoryService matches raw (no holds active). Clean start.

## CHECK A — happy path (remap A→B, let retag finish, restart)

### A1. Remap performed via MatterManagerDialog (real UI toggles)
Unchecked "The Hendersons" under A (was checked), checked it under B (was unchecked).
Post-click folderPaths: `A_fp=[]`, `B_fp=[Maria & Luis Alvarez, The Hendersons]`. F is now mapped to B.

### A2. After the live retag settled (pre-restart)
```
raw_A F=0 (total 0)   raw_B F=4 (total 23)
ms_A  F=0 (total 0)   ms_B  F=4 (total 23)
banner=null, durableHold=null   (retag completed + discharged)
```
The folder's chunks were physically re-tagged A→B; A now retrieves nothing (its only folder moved),
B retrieves the Hendersons content. MemoryService matches raw (no residual hold). The live retag on
5 files completed in ~2-3s.

### A3. After APP RESTART (kill node/cargo/lantern/webview → relaunch scheduled task → boot-restore)
```
raw_A F=0 (total 0)   raw_B F=4 (total 23)
ms_A  F=0 (total 0)   ms_B  F=4 (total 23)
banner=null, durableHold=null
A_fp=[], B_fp=[Maria & Luis Alvarez, The Hendersons]
```
**CHECK A VERDICT: PASS.** Across a full process restart, the Hendersons folder answers only under
client B; client A retrieves none of it (both the raw physical index and the real MemoryService
product path agree). The re-map is durable.


---

## CHECK B — durable hold across a kill-mid-retag  →  **BLOCKED (could not validly test)**

Check B requires the branch's QA-44 R7-3 code to be RUNNING in the app:
`scheduleFolderMatterRetag` (records the durable hold up-front), `recordDurableFolderHold` /
`pendingFolderRetagStore` (the persisted per-workspace hold), `restoreFolderHolds` (re-establishes
the hold at next boot), and the `ScopeUpdateBanner`.

During Check B setup I found these functions are **absent from the frontend the webview is actually
running** — it executes STALE pre-R7-3 code — even though the code is present and correct ON DISK at
HEAD 6fdcc5ed and served correctly by Vite to VM-side clients. See `stale-frontend-evidence.txt` for
the full char-level proof and the seven remediation attempts (Vite cache clear, WebView2 profile
wipe ×3, `--disable-http-cache`, CDP hard-reload ×2, a FULL VM reboot, and a production
`vite build` + `vite preview`) — none made the webview load the fresh code, while VM-side `curl`
stayed fresh throughout.

Consequence: on the stale frontend a folder remap produced **no** durable-store write
(`lantern:pending-folder-retag` never written — proven by a `localStorage.setItem` spy over a 9s
window) and **no** scope-update banner, and `MemoryService.retrieve` never withheld the folder
(a 15s change-timeline showed the physical retag starting ~5s after the remap and completing ~7s,
with `dur=0`/`banner=0` throughout). This absence is EXACTLY what you'd expect when the R7-3 code
isn't loaded — it is **NOT** evidence of a branch defect, and it does **NOT** prove Check B fails.
It means Check B could not be exercised on this bench.

**CHECK B VERDICT: BLOCKED — bench/tooling limitation, not a branch FAIL.**

## CRITICAL FINDING — this bench's WebView2 ran STALE frontend and could not be refreshed

The bench was brought current by an **in-place `git checkout` of `lp/swallow-p0` while the desktop
app / Vite dev server was already running** (on `lp/ui-simplification`) — the likely ORIGIN of the
stale bytes. But the staleness proved far stickier than a normal cache: the WebView2 client kept
serving the pre-checkout module for `localhost:5173` URLs even after Vite cache clears, three full
WebView2-profile (`EBWebView`) deletions, `--disable-http-cache`, CDP `clearBrowserCache` + hard
navigations, **a full VM reboot**, and a production `vite build` + `vite preview`. Throughout, the
Vite/preview server served the CORRECT fresh code to every VM-side `curl`/`Invoke-WebRequest`; only
the WebView2 client got stale bytes for the same URL. **A clean reboot did NOT clear it**, so I could
not pin the exact mechanism (it is not a simple HTTP cache) — but empirically the running webview
never loaded the fresh frontend on this bench.

Practical implication for the dev-mode bench fleet (holds regardless of root cause): **a dev-mode
bench can execute OLD frontend code with no visible warning, and it may not self-correct even after a
reboot.** Frontend verdicts from such a bench are untrustworthy. Before trusting one, confirm a KNOWN
target-branch symbol is actually present in the RUNNING webview
(e.g. `import('/src/...').then(m => typeof m.<newExport>)`), not merely on disk or via a VM-side
`curl`. The safest path is a packaged/production build with content-hashed assets, or a bench
provisioned clean on the target branch and verified at the running-webview level.
