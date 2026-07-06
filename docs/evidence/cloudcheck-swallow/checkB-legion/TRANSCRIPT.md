# swallow-p0 Check B on the LEGION — VERDICT: **PASS**

**Worker:** cc-lantern-legioncheck · **Bench:** the physical **Legion** Windows laptop
(Tailscale `james@100.127.67.22`), driven over WebView2 CDP (port 9223) with
`scripts/desktop-drive.mjs` + small CDP scripts. **Cloud benches untouched.**

**Branch/build under test:** `lp/swallow-p0-r8` @ **`2efa2e05`** (the final merge candidate).
Brought `C:\lantern-plus` to this exact SHA on a CLEAN checkout (all app/dev/build
processes killed BEFORE `git checkout`), cleared the Vite cache, rebuilt, relaunched.

## Why the Legion (context)
The two cloud benches produced a proven pathology: their WebView2 client executed a
**stale** pre-R7-3 frontend for the identical URL that curl fetched fresh — so Check B
could not be validly exercised there (see `../checkB-bench2/`). Jameson postponed the
demo, so the coordinator lifted the Legion freeze. The Legion demonstrably runs fresh
code, so Check B was run here.

## Runtime-freshness proof FIRST (the mandatory gate) — result: **PASSED**
Full detail in [`freshness-evidence.txt`](./freshness-evidence.txt) and
[`freshness-proof.json`](./freshness-proof.json). In one line: in the RUNNING webview,
`import('/src/platform/rag/pendingFolderRetagStore.ts')` **resolved** and its r8-only
export `pendingFolderRetagHydrationSuspect()` returned a real boolean — the exact import
that **failed** on both cloud benches. The webview URL was the clean `localhost:5173/`,
not the benches' frozen poisoned origin. The Legion provably executes `2efa2e05`.

## Check B — the test
**Test workspace:** the live "Beacon Ridge Demo" advisor workspace (3 clients, 3 indexed
folders). **Client A** = *Maria & Luis Alvarez* (folder `…/Beacon Ridge Demo/Maria & Luis
Alvarez`, 5 real docs). **Client B** = *Dr. Priya Nair*.

The remap was driven through the app's **own** `useMatterStore` (the exact end-state a UI
folder-reassignment produces), which fires the real `useMemoryWiring` subscription →
`changedFolderPaths` → `scheduleFolderMatterRetag`. Retrieval was verified with the real
**`MemoryService.retrieve(query, 50, {kind:'matter', matterId})`** — the same path *Ask*
uses; retrieval embeds locally (e5-small), so no API key was needed and the fail-closed
exclusion (`shouldExcludeHitFromRetrieval`) is applied exactly as in production.

### Step 0 — baseline (folder mapped to A) — `01-baseline-clientmap.jpeg`
- `retrieve(A)` → 6 hits, **all 6 under the Alvarez folder** (A finds it).
- `retrieve(B)` → 6 hits, **0 under the Alvarez folder** (client isolation holds).
- No holds; no banner.

### Step 1 — remap A→B, hold recorded — `raw-remap-hold-recorded.json`
Immediately after the remap (synchronous read-back, before the async re-index):
- durable store `heldForWorkspace` = **[the Alvarez folder]** (recorded up-front).
- scope entry `matter:<folder>` status **retrying**; `excludedMatterFolders` = [folder].
- `shouldExcludeHitFromRetrieval({Alvarez file, matterId:A})` = **true** (fail closed).
- folder now mapped to **Dr. Priya Nair**.

### Step 2 — KILL the app mid-retag (real OS kill)
Killed with the scope entry still **"retrying"** (re-index in flight) → the re-tag to B
never completed → the folder's index rows stay physically tagged to **A**, and the durable
hold is persisted to disk. `KILL: app down, ports free`.

### Step 3 — relaunch; hold RESTORED at boot — `raw-held-at-boot-frames.log`
Rapid CDP sampling of the boot caught the transition (frame-by-frame):
- frames 0–3: `folderStillHeld = true` — **the durable hold survived the real process
  kill** and is present at boot (loaded from persisted `lantern:pending-folder-retag`).
- frames 2–3: `restoreFolderHolds` re-established the fail-closed scope exclusion —
  `excludedMatterFolders = [the Alvarez folder]`, a **failed** scope-update entry (the
  banner), and at frame 3 `shouldExcludeHitFromRetrieval({Alvarez file, matterId:A}) =
  **true**`. i.e. during the heal window the OLD client (A) has that folder **withheld**
  from retrieval → **no stale wrong-client answer.** ✅ outcome (i)
- The banner is the honest user-facing signal: *"Search scope update failed - retrying.
  Some content is held out of search until it applies."* — captured in
  `02-hold-banner-during-heal-window.jpeg` (reproduced via the identical `restoreFolderHolds`
  boot code path so it could be photographed; the live boot window is only a few seconds).

### Step 4 — after the heal — `raw-healed-verify.json`, `03-post-heal-state.jpeg`
Once the boot in-place retag ran and discharged the hold:
- `retrieve(B)` → **6 hits under the Alvarez folder** — **B finds it.** ✅
- `retrieve(A)` → **0** Alvarez-folder hits — **A does not.** ✅
- `heldForWorkspace` empty, `excludedMatterFolders` empty, no scope entry — **banner
  clears.** ✅ outcome (ii)

Durability note: in one cycle the persisted hold survived **several** app-down periods
(failed relaunch attempts) and only discharged when the app finally booted and ran the
boot retag — extra proof the hold is genuinely durable across sessions.

### Cleanup — baseline restored — `04-baseline-restored.jpeg`
Folder remapped back B→A and healed: `retrieve(A)` = 6 Alvarez hits, `retrieve(B)` = 0,
no holds. The demo workspace is back to its original state; the Legion app was then closed.

## Honest limitations
- The **live boot heal window is only a few seconds**, so the retrieval-level "A withheld"
  frame was captured at the **predicate** level (`shouldExcludeHitFromRetrieval = true`
  while the rows were still tagged A) rather than as a single `retrieve(A)=0` call landing
  inside that window; the predicate is exactly what `MemoryService.retrieve` applies, so
  this is a sound proof, and the full `retrieve(A)=0 / retrieve(B)=6` pair is shown in the
  post-heal state. The banner screenshot was reproduced via the identical `restoreFolderHolds`
  boot code path for the same timing reason.
- The remap was driven via the app's own store action, not GUI clicks — it is the exact
  state transition a UI reassignment produces, and it fires the identical production wiring.

## VERDICT
**CHECK-B: PASS.** On provably-fresh `2efa2e05`, across a real mid-retag process kill and
relaunch: the durable folder hold survived, was restored at boot (banner + old-client
retrieval withheld → no stale wrong-client answer), and after the heal the new client
finds the folder, the old client does not, and the banner clears.
