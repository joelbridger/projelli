# Northcrest Wealth Partners — Windows Demo Playbook

**Date:** 2026-06-24 · **Audience:** the next human or AI who has to make the advisor demo run on real Windows, smoothly, every time.

> **What this demo proves:** point Advisor Prep Hero at a real (fake) advisory firm's messy
> folder of 374 files (statements, tax returns, financial plans, meeting notes,
> emails, estate docs), and it (1) reads them into its private on-device index,
> (2) builds a **Client Map** per household automatically, and (3) answers
> questions per client with **citations** back to the source files — with strict
> **client-to-client isolation** (one client's data never surfaces in another's
> chat). Star client for the walkthrough: **the Hollings Family** (a ~$47M
> UHNW household with a business exit, trusts, DAF grants, 529 superfunding).

---

## 0. TL;DR — the two ways to run it, and which to use

| | **Production build (installed app)** | **Dev bench (`tauri:dev`)** |
|---|---|---|
| Reliability | **High** — deps bundled, no dev server to die | Fragile — the Vite dev server dies on dep re-optimization/reload, which silently breaks PDF indexing (see §6.2) |
| Use it for | **The actual demo Jameson shows** | Fast iteration / engineering only |
| PDF indexing | Works out of the box | Works only with the workarounds in §6.2 |

**Recommendation: demo on a production/installed build.** The dev bench is great
for engineering, but its Vite dev server keeps dying on this WebView2 box (it gets
killed by the full-page reload Vite does when it discovers a lazily-imported dep at
runtime). EVERY dev-only failure traced back to that single cause: PDF indexing
silently fails, the Client Map panel white-screens, and **Ask fails with "couldn't
reach your AI provider"** (the AI request goes through Vite's `/api/openai` proxy,
which dies with the server — `ERR_CONNECTION_REFUSED`). A production build has **no
Vite server**: the frontend is bundled and AI requests go **direct from the app to
OpenAI** (the product's real BYOK-direct design), so none of this happens.

### ✅ Fast "production mode" on the bench (VALIDATED 2026-06-24 — Ask works here)
You do NOT need a full 30-min `tauri build`. Serve the *built* frontend with
`vite preview` and run the already-warm debug binary against it:
```
# 1. build the production frontend (also typechecks): ~30s
ssh james@100.127.67.22 'cmd /c "cd /d C:\keepance && npm run build"'   # NOTE: cmd /c — PowerShell blocks npm.ps1
# 2. swap the launcher (scripts/demo/run-preview.bat): runs `vite preview --port 5173`
#    + C:\keepance\src-tauri\target\debug\keepance.exe (same WebView2 profile, so all
#    seeded localStorage + the workspace index carry over — no re-seed needed)
ssh james@100.127.67.22 "Copy-Item C:\run-dev.bat C:\run-dev.bat.bak -Force"   # back up dev launcher
scp scripts/demo/run-preview.bat james@100.127.67.22:C:/run-dev.bat
ssh james@100.127.67.22 "Stop-Process -Name node,cargo,keepance,msedgewebview2 -Force -EA SilentlyContinue; Start-Sleep 7; Start-ScheduledTask Advisor Prep HeroDev"
# Restore dev later: ssh james@... "Copy-Item C:\run-dev.bat.bak C:\run-dev.bat -Force"  (then restart)
```
In this mode the Client Map renders, PDFs index, and **Ask returns cited,
file-grounded answers** (e.g. Hollings: "the projected federal estate tax liability
is about $8,892,000 ... the ILIT provides tax-free liquidity"). The vector index
lives in the workspace folder, so it is reused across dev/preview/installed builds.

Everything below works on either mode; the dev-specific landmines are called out.

**Everything is reproducible from saved scripts:** `keepance/scripts/demo/`
(seed, retag, index PDFs, build maps, verify). The Northcrest file set lives at
`~/keepance-demo-data/` (regenerate with its own build; deliverable zip
`dist/Northcrest-Wealth-Partners-demo.zip`).

---

## 1. The machine: the Legion Windows bench

- Tailscale device `laptop` = **`james@100.127.67.22`** (admin). If it's offline
  (`tailscale status` shows "offline"), it's powered down — **the one thing to
  ask Jameson for is to power it on.** Everything else is the AI's job.
- App repo on the box: **`C:\keepance`** (a plain file copy, NOT a git checkout —
  sync via tarball, not `git pull`).
- Dev app launched by the **`Advisor Prep HeroDev`** scheduled task → `C:\run-dev.bat`
  (`npm run tauri:dev`, log → `C:\tauri-dev.log`).
- The WebView2 UI exposes **CDP on `127.0.0.1:9223`** (env var
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` is set).
- Drive the app by its data-testids: **`scripts/legion-drive.sh <snapshot|click|type|eval|screenshot|waitfor>`**
  (runs `desktop-drive.mjs` ON the Legion against 9223).
- Bring code up to date: **`scripts/legion-sync-launch.sh`** (packs `src/` → scp →
  restart → waits). NOTE its readiness poll has a cosmetic bug (`cdp=?`); confirm
  readiness yourself with the port check in §3.

### SSH / PowerShell gotchas (these cost real time)
- Default remote shell is **PowerShell** (no `&&`; use `;`).
- **Never pass non-trivial JS to `legion-drive.sh eval`** — PowerShell mangles
  `()`, `{}`, `\n`, quotes. Instead **write a `.mjs` file, scp it to
  `C:\keepance\`, and run `node <file>.mjs`** (it inherits `C:\keepance\node_modules`,
  so Playwright + app modules resolve). All the demo scripts work this way.
- For multi-line PowerShell, write a `.ps1`, scp it, run `powershell -File`.
- scp/ssh occasionally throws "banner exchange timeout" — just retry.

### The superpower: drive the REAL app internals over CDP
Because dev runs Vite, you can **dynamically import the app's own modules** inside
`page.evaluate`, e.g. `await import('/src/platform/rag/MemoryService.ts')`, and you
can call Tauri commands directly via `window.__TAURI__.core.invoke('rag_retrieve', …)`
(`withGlobalTauri` is on). This is how the demo scripts seed state, re-tag chunks,
index PDFs, build maps, and verify retrieval without clicking through the UI.

---

## 2. Stage the Northcrest files on the Legion

```bash
scp ~/keepance-demo-data/dist/Northcrest-Wealth-Partners-demo.zip james@100.127.67.22:C:/Northcrest-demo.zip
# then expand on Windows to: C:\keepance-demo-northcrest\Northcrest Wealth Partners\
#   (contains Clients\<26 households>\ and _Firm\ and a README)
ssh james@100.127.67.22 powershell -File C:/expand.ps1   # Expand-Archive helper
```
Expect **374 files, 26 client folders, plus `_Firm`** (firm-wide docs that stay
*unassigned* to any client — that's correct).

---

## 3. Bring the app up + confirm it's drivable

```bash
scripts/legion-sync-launch.sh        # sync current frontend + restart (or just restart if code is current)
# Confirm readiness yourself (the script's own poll is buggy):
ssh james@100.127.67.22 "(Get-NetTCPConnection -LocalPort 9223 -State Listen -EA SilentlyContinue|Measure-Object).Count; (Get-NetTCPConnection -LocalPort 5173 -State Listen -EA SilentlyContinue|Measure-Object).Count"
# both should print 1
scripts/legion-drive.sh snapshot     # should show the workspace-selector or main shell
```

---

## 4. Seed the app: advisor mode, settings, the 26 clients

All of this is one script: **`scripts/demo/legion-seed.mjs`** (+ the matters JSON
generated by `gen_matters_seed.py`). scp both to `C:\keepance\` and run:

```bash
node legion-seed.mjs C:/northcrest_matters.json
```
It writes localStorage (preserving each store's persist wrapper):
- `keepance_profession = advisor`, `keepance_onboarding_complete = true`
- `keepance:settings` → merges `memoryEnabled`, `includePdfsInWorkspaceIndex`,
  `ocrScannedPdfs` all **true** (PDF indexing is **OFF by default** — see §6.1)
- `keepance:matters` → the 26 clients (shape `{state:{matters,activeMatterId},version:5}`)
- `keepance_recent_workspaces` → prepends the Northcrest workspace

Then **restart** so the stores rehydrate (a localStorage write while the app is
running is NOT picked up until restart; and **never `location.reload()`** the dev
bench — it kills Vite. Always restart the `Advisor Prep HeroDev` task instead):
```bash
ssh james@100.127.67.22 "Stop-Process -Name node,cargo,keepance,Advisor Prep Hero,msedgewebview2 -Force -EA SilentlyContinue; Start-Sleep 7; Start-ScheduledTask Advisor Prep HeroDev"
```

> ### 🔑 4.1 THE #1 LANDMINE: `folderPaths` format
> A client's `folderPaths` must match the path format the indexer resolves
> against. The file tree is **workspace-relative** (`Clients/Hollings Family/…`),
> but the bulk walk stores **absolute** paths, and `rag_index_file` needs an
> **absolute, readable** path. The net effect (today) is a path-format mismatch
> across the office-walk / PDF-pass / folder-retag code paths (see §7, BUG-A).
>
> **What actually works** (encoded in the scripts): seed `folderPaths` **absolute**
> (`C:/keepance-demo-northcrest/Northcrest Wealth Partners/Clients/<household>`),
> then tag chunks with the explicit scripts in §5 rather than relying on the app's
> automatic per-folder tagging. The resolver normalizes `\`↔`/` but is
> **case-sensitive** and has **no drive-letter normalization**, so keep the casing
> and `C:` exactly consistent with how the workspace is opened.

---

## 5. Index + tag everything (the part the app won't do correctly on its own yet)

Run order (all scripts in `keepance/scripts/demo/`, run from `C:\keepance` with
`DESKTOP_CDP_PORT=9223`):

1. **Open the Northcrest workspace** (click the recent entry):
   ```bash
   scripts/legion-drive.sh click recent-workspaces-toggle
   scripts/legion-drive.sh click recent-workspace-row     # first row = Northcrest
   scripts/legion-drive.sh click feature-tour-skip
   ```
   This triggers the office/text bulk walk (the "Indexing workspace: N/73" banner —
   **73 = only Word/Excel/text files; the 301 PDFs are a separate, silent pass**, see §6.3).

2. **Re-tag office/text chunks to their client** — `legion-retag.mjs`. The bulk
   walk tags everything `unassigned`; this re-tags in place (no re-embed) by
   trying each candidate path format per file (`rag_retag_matter` only updates the
   rows whose tokenized path matches, so the right format wins). Expect ~169 office
   rows updated across the client folders.

3. **Index all 301 PDFs** — `legion-indexpdfs.mjs`. Reads each PDF's bytes in Node
   (bypasses the flaky auto-pass) and calls the real `indexPdfFile` with an
   **absolute** in-app path so the resolver tags each PDF to its client. The 3
   scanned PDFs go through local OCR (slower). **Dev caveat: do this right after a
   fresh restart (§6.2).** Expect `indexed=301 failed=0`.

4. **Build Client Maps for the deep households** — `legion-buildmaps.mjs`
   (Hollings + Ellison + Webb + Voss + Nakamura + Patel). Calls the real
   `buildClientMap(matterId)` + persists via `clientMapStore.setMap`. Needs a valid
   BYOK key (the bench has an OpenAI key; egress shows "Sent to your OpenAI account").

5. **Verify** — `legion-verify.mjs`: per-client scoped retrieval, cross-client
   isolation (a Hollings-only term scoped to Webb must return **0** Hollings hits),
   and the Hollings demo questions. Quick ad-hoc checks: `legion-probe3.mjs`.

---

## 6. Dev-bench landmines (why PDFs are the hard part)

### 6.1 PDF indexing is ON by default (corrected)
`includePdfsInWorkspaceIndex` defaults **true** (since commit `84c91c05`,
2026-06-20 — "default PDF indexing ON so scanned-filing search works out of the
box"); no override in `PRIVACY_CRITICAL_SAFE_DEFAULTS`. So PDFs index out of the
box. The seed sets it true redundantly. (An earlier version of this playbook
wrongly said off-by-default.)

### 6.2 The Vite dev server dies → PDF.js fails to load
`pdfjs-dist` and `tesseract-wasm` (OCR) are **lazy-loaded**. On `tauri:dev`, the
first runtime import makes Vite re-optimize deps and trigger a **full page reload**,
and on this WebView2 bench a reload **tears down the Vite dev server**. After that,
every PDF import fails with `Failed to fetch dynamically imported module … pdfjs-dist`
and PDFs silently don't index.

Mitigations (both applied here):
- **`optimizeDeps.include: ['pdfjs-dist', 'tesseract-wasm']`** added to
  `vite.config.ts` — pre-bundles them at startup so the *first* import doesn't
  re-optimize. (Dev-only; ignored by production builds. Legit robustness fix.)
- **Index PDFs immediately after a clean restart**, before anything else can
  trigger a reload: kill procs → `Remove-Item node_modules\.vite` → start
  `Advisor Prep HeroDev` → wait for 5173+9223 → open workspace → run `legion-indexpdfs.mjs`.
  If Vite is dead (`5173` not listening), PDF indexing CANNOT work — restart first.

**The clean fix is to demo on a production build** (no Vite, deps bundled).

### 6.3 The indexing banner under-counts
The "Indexing workspace: N/73" banner counts **only** office/text files; PDFs index
on a separate pass **with no progress UI**. A user who imported 374 files sees "73"
and may think the rest were ignored. **Product/UX issue** (see §7, BUG-D).

---

## 7. Bugs / issues found (for the report + backlog)

- **BUG-0 (FIXED this session — real production crash): opening the Client Map
  white-screens the whole app.** `ClientMapTemplates.tsx` selected
  `useTemplatesStore((s) => Object.values(s.templates))` — a selector that
  returns a fresh array every render. With Zustand's `Object.is` equality that
  trips React's "getSnapshot should be cached" → an infinite re-render →
  **"Maximum update depth exceeded"** that unmounts the entire tree (blank page).
  This is NOT dev-only; it would crash in production the first time the Client
  Map panel renders. **Fix:** wrap the selector in `useShallow` (matches the
  existing `aiChatStore` pattern). Confirmed fixed on the bench (panel renders;
  no error). This was found ONLY by driving the real app — it has no unit test.
  **Add a regression test** that renders `ClientMapTemplates` and asserts no loop.

- **BUG-A — FIXED + Windows-verified (merged to keepance-3.0, commit `553ba78d`).**
  Mapping a client folder now tags ALL its file types: `reindexFolderPaths`
  re-indexes office/text with the **absolute** disk path (so `rag_index_file` can
  read it + upsert the walk's chunk in place) and routes **PDFs** through
  `indexPdfFile` (which it used to skip), plus a one-time retag after the initial
  index for matters mapped at import. Verified in the real UI on Windows: created
  a client, toggled the `_Firm` folder → client-scoped results went 0 → 18
  (Word + Excel + PowerPoint + **PDF**). Edge case: if a workspace is opened with
  a non-native path separator, an old `unassigned` office duplicate can linger
  until a clean re-index (PDFs unaffected). Original (now-fixed) description:
  per-client tagging didn't "just work" on import —
  The office/text bulk walk tags every chunk `unassigned`; per-client tagging only
  fires on a *folder-mapping change*, and that retag path (`reindexPaths` →
  `rag_index_file`) is fed **workspace-relative** paths while `rag_index_file`
  needs an absolute/readable path — so re-tagging office/text via the normal folder
  assignment is unreliable. For an advisor whose files are mostly PDF, PDFs are also
  not re-tagged on folder change (`rag_index_file` skips PDFs). Net: clients created
  *after* import (or pre-seeded) can end up with their content `unassigned` →
  empty Client Maps and empty scoped search. Needs a real fix (consistent path
  handling + a folder-change retag that covers PDFs).
- **BUG-B (reliability, dev-only but severe): PDF indexing breaks on `tauri:dev`**
  because Vite dies on dep-optimize/reload (§6.2). Fixed for dev via `optimizeDeps`
  + restart discipline; the real fix is to demo on a production build.
- **BUG-C — RESOLVED:** PDF indexing already defaults **ON** (commit `84c91c05`,
  2026-06-20). No action needed. (The earlier "default off" note was wrong.)
- **BUG-D (UX): the indexing banner counts office/text only**; PDFs index silently
  with no progress, so the count looks wrong and there's no signal PDFs are being
  read (or OCR'd). Add PDF/OCR progress to the banner.

---

## 8. The demo walkthrough (what to actually show)

1. **Onboard as an advisor** → workspace = the Northcrest "practice folder."
2. **Open a client (Hollings Family)** from the Clients list. Show the file tree:
   real statements, tax returns, plans, meeting notes, emails, estate docs.
3. **Open Client Map** (`hub-panel-clientmap-open`) → it builds itself: the story
   so far, key people, where things stand, what's coming, next actions — each item
   citing the source file.
4. **Ask the file anything** (cited answers), e.g.:
   - "What is the central planning issue for this household?" → the business exit
     of Hollings Capital Partners (~$12.75M, 82% owned), concentration + deal-readiness.
   - "What did we decide at the last review?" → de-risk ahead of the exit, build the
     cash runway, rebalance to target.
   - "What's the status of the DAF grants?" / "What's the Cascade Fund IV capital call?"
5. **Show isolation:** ask the same question while focused on a *different* client —
   Hollings' answers never appear.

---

## 9. Rollback / cleanup
- Northcrest workspace + index live entirely under
  `C:\keepance-demo-northcrest\` (LanceDB at `…\Northcrest Wealth Partners\.keepance\`).
  Delete that folder to wipe the index for a clean re-run.
- The seed only touches localStorage keys listed in §4 (re-seed to reset).
- Demo scripts: `keepance/scripts/demo/`. Helper drivers: `scripts/legion-drive.sh`,
  `scripts/legion-sync-launch.sh`, `scripts/desktop-drive.mjs`, `scripts/legion_agent.py`.
