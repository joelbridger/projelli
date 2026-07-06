# swallow-p0 Check B re-run on a CLEAN bench (bench-2) — VERDICT: BLOCKED

**Worker:** cc-lantern-cloudcheck2 · **Bench:** lantern-cloud-bench-2 (Azure, Tailscale
`lantern-cloud-bench-2-1` = 100.88.113.105), driven over WebView2 CDP (VM port 9223 →
local tunnel 9444). **bench-1 stayed off. Legion untouched.**

**Branch/build under test:** `lp/swallow-p0-r8` @ **`2efa2e05`** (the FINAL merge candidate:
R7 rounds + R8 fixes + hardening). Brought the bench to this exact SHA on a CLEAN checkout
(all app/dev-server/build processes killed BEFORE `git checkout`, per the bench-1 lesson),
then rebuilt.

## Bottom line
**CHECK-B: BLOCKED.** The bench's WebView2 client persistently executes a **STALE frontend**
(pre-R7-3 code) and could not be refreshed by ANY means tried — including a full production
build and a full VM reboot. The branch's R7-3/R8 durable-folder-hold frontend code
(`pendingFolderRetagStore`, `scheduleFolderMatterRetag`, `recordDurableFolderHold`,
`restoreFolderHolds`, `ScopeUpdateBanner`) **never executed in the running webview**, so Check B
could not be validly exercised. **This reproduces — and strengthens — the predecessor's bench-1
finding on a freshly-provisioned bench-2. It is a bench/WebView2 tooling pathology, NOT a branch
defect.**

---

## Freshness protocol (the mandatory gate) — result: FAILED, exhaustively

The brief required proving the running webview executes the NEW code BEFORE testing. It does not,
and cannot be made to. The core symptom, reproduced many times:

> **For the exact same URL, a VM-side HTTP client (curl / Invoke-WebRequest) receives the FRESH
> R8 code, while the WebView2 client receives STALE pre-R7-3 code — even with cache-busting query
> strings, `cache: 'no-store'`, a wiped profile, a renamed data folder, a production build, and a
> reboot.**

### Disk / git truth (correct)
- `git rev-parse HEAD` = `2efa2e05add7396546a826bce28252be7b52d88e` (exact target), tree clean.
- `src/platform/rag/pendingFolderRetagStore.ts` present on disk; contains the R8 export
  `pendingFolderRetagHydrationSuspect` and the durable-hold store key `lantern:pending-folder-retag`.
- `src/platform/hooks/useMemoryWiring.ts` on disk = **114,723 bytes** (the new R8 version).
- Production build (`npm run build`, 40.55s) produced a content-hashed `dist/`; the R8 marker
  string `lantern:pending-folder-retag` is present in the built bundle (`dist/assets/App-COHHWgTG.js`).

### The webview runs STALE code (smoking gun)
With a **DEV Vite** serving `[::1]:5173`:
- **VM-side** `Invoke-WebRequest .../pendingFolderRetagStore.ts` → `text/javascript`, **17,254 bytes,
  contains `pendingFolderRetagHydrationSuspect` = True** (FRESH).
- **WebView2** `fetch('/src/platform/rag/pendingFolderRetagStore.ts?<busted>', {cache:'no-store'})`
  → `text/html`, **931 bytes** (Vite SPA fallback = "module not found"), R8 symbol absent (STALE).
- **WebView2** `fetch('/src/platform/hooks/useMemoryWiring.ts')` → **157,157 bytes**, no
  `scheduleFolderMatterRetag` / `recordDurableFolderHold` / `restoreFolderHolds` (OLD pre-R7-3 code),
  while the disk file is the new 114,723-byte version.
- `import('/src/platform/rag/pendingFolderRetagStore.ts')` in the webview →
  "Failed to fetch dynamically imported module".

With a **production Vite PREVIEW** (content-hashed `dist/`) serving `[::1]:5173`:
- **VM-side** `Invoke-WebRequest http://[::1]:5173/` → PROD index (942 bytes, references
  `/assets/index-DdIj3-BH.js`).
- **WebView2** `document` → DEV index (`/@vite/client` + `/src/main.tsx`, with React-Refresh
  preamble — a DEV-only artifact a static preview server can NEVER emit).

The webview's own network is decoupled from reality: `navigator.serviceWorker.getRegistrations()`
= `[]`, `caches.keys()` = `[]`, no system proxy (WinINET `ProxyEnable=0`, `netsh winhttp` = direct),
no hosts-file redirect (only Tailscale MagicDNS entries), no WebView2 group policy.

### The frozen page
The webview URL is stuck at **`http://[::1]:5173/?fresh=1783358744`** (a cache-bust token this
worker set hours earlier) across EVERY relaunch — including a production build-mode binary and a
reboot, neither of which should ever touch `[::1]:5173`. The rendered page shows stale app state:
"Recent (1) → `C:/Users/james/Documents/Beacon Ridge Demo`" — a user (`james`) and workspace that
DO NOT EXIST on bench-2 (only `lpbench` exists). See `frozen-webview.jpeg`.

---

## Remediations attempted — ALL failed to make the webview run fresh code
(each verified at the running-webview level, VM-side curl stayed fresh throughout)

1. **Clean checkout discipline** — killed ALL node/cargo/webview/vite/esbuild processes and
   disabled the launch tasks BEFORE `git checkout 2efa2e05`; wiped `node_modules/.vite` and the
   WebView2 profile first. (This was the fix for bench-1's suspected in-place-checkout cause.)
2. **Dev mode** (`tauri:dev`, fresh Vite) — stale.
3. **Production `vite preview`** (content-hashed assets) on the baked port **5173** — stale.
4. **Production `vite preview`** on a fresh port **5273** (+ `devUrl` override) — the webview
   ignored the override and stayed on the frozen `5173/?fresh` page.
5. **WebView2 profile wipe** (`com.lantern.app\EBWebView`) — stale.
6. **Full data-folder rename** (`com.lantern.app` → `.WIPED`, brand-new profile) — stale.
7. **Production build-mode binary** (`tauri build --debug --no-bundle`, embedded assets,
   `tauri.localhost` origin) run standalone — booted to the frozen `5173/?fresh` page anyway.
8. **FULL VM REBOOT** + fresh profile + build-mode + PROD preview on 5173 + navigation to a
   brand-new `localhost:5173/?boot=<t>` URL — STILL served DEV `/src/main.tsx`, no R8 marker.

## New characterization (sharper than bench-1's report)
- The staleness is bound to the **`[::1]:5173` origin's WebView2 state** and is **unclearable** by
  profile wipe, data-folder deletion, OR reboot.
- The **`tauri.localhost`** custom-protocol origin (build-mode) is a **clean, un-poisoned origin** —
  it responds "asset not found", NOT the frozen page. However, this project's `tauri build --debug`
  binary **embeds no frontend assets** (`http://tauri.localhost/index.html` → 500 "asset not found:
  index.html"), so it cannot serve the fresh bundle there either, and it defaults to loading the
  poisoned `devUrl` (5173).
- No service worker, CacheStorage, HTTP proxy, hosts redirect, or WebView2 policy is involved.

---

## Recommendation (to unblock Check B)
A cloud **dev-mode** bench on this snapshot lineage (bench-1 and bench-2 both) **cannot run
verified-fresh frontend code**. To actually exercise Check B:
1. **Provision a genuinely NEW Windows VM image** (not this snapshot family) clean on
   `lp/swallow-p0-r8`, and verify at the running-webview level before testing; **or**
2. **Fix why this project's `tauri build` does not embed `frontendDist`**, then run a real packaged
   production app that boots to the clean `tauri.localhost` origin with content-hashed assets; **or**
3. Run Check B on the **Legion** (currently pinned).

## Standing facts for the merge decision
- **Check A PASSED live** on bench-1 (happy-path remap→restart; predecessor evidence @ `b80e28ce`).
- The R7-3/R8 durable-folder-hold logic is **present and correct on disk** at `2efa2e05` and is
  covered by unit tests. Check B's **live** path on a cloud bench remains **characterized but not
  live-verified** due to this bench pathology — not due to any observed branch failure.

## Money guardrail
bench-2 deallocated (`az vm deallocate -g lantern-bench -n lantern-cloud-bench-2 --no-wait`) at the
end of this run. No Azure resources were created.

## Files
- `frozen-webview.jpeg` — the stale webview rendered post-reboot on the build-mode binary
  (shows the nonexistent `C:/Users/james/...` recent workspace).
- `freshness-evidence.txt` — raw probe outputs (webview-vs-VM byte comparisons, SW/cache/proxy
  checks, per-remediation URL states).
