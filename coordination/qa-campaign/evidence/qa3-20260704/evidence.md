# qa3 (persona D, edge-case hunter) — evidence log, 2026-07-04

Seat: browser dev build (`npm run dev` in `~/lp-qa3`, port 5177, strictPort), driven via the
always-on Chrome over CDP. Screenshots in this folder were captured directly via CDP
`Page.captureScreenshot` (bypassing the MCP screenshot tool's non-persistent inline image return).

## Harness note (not a product bug, but worth recording for future explorer lanes)

The workspace "New Workspace" / "Open Existing" buttons and "Add files" call the real File System
Access API (`showDirectoryPicker`/`showOpenFilePicker`), which (a) requires a secure context, and
(b) opens a native OS dialog outside the page DOM that this session's tools cannot drive directly.
Fix used: `docker exec jameworld-chrome` — appended `172.20.0.1 qa3.localhost` to `/etc/hosts`,
then ran a tiny Python asyncio TCP proxy inside the container (127.0.0.1:5177 → 172.20.0.1:5177) so
Chrome could load the page as `http://127.0.0.1:5177/` and get `isSecureContext: true`. Both the
`/etc/hosts` line and the proxy process were removed again after use. For the native-picker problem
itself, testing instead went through the app's own sanctioned test harness entry point,
`?testMode=true` (see `src/app/lifecycle/useTestModeWorkspace.ts`), which is exactly what this
repo's own Playwright specs use — a real in-memory WorkspaceService + real matterStore, no native
dialogs. `window.__mockWorkspaceFs.seed()` / `__setTestFileTree()` were used to inject edge-case
files; a dynamically-imported ES module (`import {useMatterStore} from '/src/platform/matter/matterStore.ts'`)
gave direct store access for bulk operations (creating 500 clients) that would be too slow to drive
through the UI.

**Tooling quirk found and worked around:** in this session, the MCP `chrome_click` tool (synthetic
CDP mouse dispatch) frequently failed to trigger onClick handlers that a real `.click()` call (via
`chrome_eval`) fired correctly on the identical element (confirmed via `elementFromPoint` showing no
overlay). Root cause not identified — flagged for whoever owns the chrome-cdp tooling, not filed as
a product bug. Every finding below was double-checked with a reliable interaction method before being
recorded.

## QA-14 — i18n: language switch doesn't translate the core app

- `localStorage['lantern:settings']` after setting language to Deutsch:
  `{"state":{"values":{},"_migrated":false,"featuresTourCompleted":false,"language":"de"},"version":1}`
  — persisted correctly, survives a full page reload.
- Yet after switching + reloading, `document.querySelectorAll('button')` main nav still reads
  literally "Client Map" / "Ask" / "Workflows" (English), while the Settings panel itself (opened at
  the same time) is fully German ("Sprache", "Einstellungen durchsuchen…", etc.) — see
  `01-locale-de-nav-still-english.png` vs `02-settings-de-translated.png`.
- Source-confirmed root cause — hardcoded literal strings, not `t()` calls:
  - `src/app/shell/layout/Spine.tsx:73-75` — `{ id: 'matters', label: 'Client Map', ... }`,
    `label: 'Ask'`, `label: 'Workflows'` (the entire primary left nav).
  - `src/features/matters/MatterHub.tsx:87-89` — the per-client hub's own tab labels ('Client Map',
    'Documents', 'Email') are the same pattern.
  - `src/features/matters/MattersHome.tsx:272` — `const askActionLabel = 'Ask';` (the row quick-action
    button on the Client Map table).
  - Translation resources DO exist and are substantial (`src/locales/de.json` has 1524 keys vs 1058
    in `en.json`, only 40 keys genuinely missing from de) — this is not a "translations don't exist"
    gap, it's specific core-chrome components never wired to `t()`.
- Not a blanket "nothing is translated" bug — spot-checked and some elements ARE properly localized
  (e.g. the "Report a bug" button's aria-label read back as "Fehler melden, wird direkt an das
  Advisor Prep Hero-Team gesendet" in German). The primary nav/tabs/row-actions are the confirmed gap.

## QA-15 — two browser tabs, same workspace: silent data loss

Reproduction (both tabs on `http://127.0.0.1:5177/?testMode=true`, same origin/localStorage):
1. Tab B: `useMatterStore.getState().createMatter({name:'Created in Tab B', client:'Created in Tab B'})`
   → `{"totalInTabB":502}`.
2. Tab A (never reloaded, still holding its own pre-B in-memory state): confirmed it does NOT see
   Tab B's client (`hasNewOne:false`, `totalInTabA:501`) — no cross-tab reactivity.
3. Tab A then creates its own client: `createMatter({name:'Created in Tab A after B', ...})` →
   `totalInTabA:502`.
4. Tab B reloaded fresh, read directly from `localStorage['lantern:matters']`:
   `{"total":502,"hasB":false,"hasA":true}` — **Tab B's own client is gone**, silently overwritten by
   Tab A's last-write-wins save of a state snapshot that never included Tab B's addition. No error,
   no conflict warning, no merge — the record is just gone.
- This is a `zustand/persist`-to-`localStorage` pattern with no `storage` event listener/BroadcastChannel
  and no optimistic-concurrency check. Mechanism is specific to the browser build's storage layer;
  flagging for a desktop re-check of the analogous scenario (two app windows/instances open on the
  same workspace folder) since the underlying "last full-state write wins" risk could have a parallel
  there depending on how the Rust/Tauri backend persists matters.

## QA-13 — Client Map "memory rebuild" message is permanent on this build, not transient

`src/features/matters/clientMap/errorClassification.ts:36-38,43` — the regex that classifies an
error as the (retryable-sounding) "index" bucket explicitly includes *"the browser's 'no Tauri
backend' throw from `ragRetrieve`"* per the file's own comment. On the browser build there is no
Rust/LanceDB RAG engine at all, so this is not an intermittent condition — every client's Client Map
tab shows "This client's memory needs to rebuild before the map can update. Try again in a moment —
if it keeps happening, reopen this client to trigger a fresh index." permanently, confirmed still
showing after 10+ minutes and several remounts. "Try again" / "reopen this client" can never resolve
it on this seat.

## Extreme/malicious naming (QA-16/17 in BUG-DB) — raw eval outputs

- Client created with name `<img src=x onerror=alert(1)>Test <script>window.__xss=true</script> Client`.
  `window.__xss` checked immediately after creation and after every subsequent tab: always `false`.
  No alert fired. React's default escaping holds everywhere the raw name is displayed (breadcrumb,
  sidebar, table, tab title, Ask composer placeholder).
- The on-disk folder actually created for that client (queried via `useWorkspaceStore` fileTree):
  `img src=x onerror=alert(1) Test script window.__xss=true script Client` — angle brackets stripped,
  everything else kept verbatim. Confirms filesystem-unsafe characters are sanitized before hitting
  the (mock/real) FS layer, while the UI's display name is left as the user's raw literal input.
- Reserved Windows device names (`CON.txt`, `PRN`), trailing-dot (`trailing-dot..txt`), trailing-space
  (`trailing-space .txt`), emoji (`emoji-🎉😀-client.txt`), CJK/accented unicode
  (`unicode-陈-Müller-Ñoño.txt`), a 255-character filename, and a zero-byte file and a 500MB
  (allocated) file were all seeded into a client's folder and rendered correctly in Grid view with no
  layout breakage, no crash, no mis-encoding. See `03-filenames-folder-view.png` for the folder
  container; the flat grid of all ten files was visually confirmed live during the session (all
  rendered correctly) but not separately saved as a file.
- Caveat: this used the mock/in-memory test-mode FS, which is more permissive than a real OS
  filesystem (e.g. a literal `<script>` filename can exist in the mock FS as a Map key, but a real
  Windows/macOS folder would reject or auto-sanitize those characters at the OS level, same as the
  client-name folder-creation case above). Flagging for a desktop re-check of Windows reserved-name
  handling specifically (CON/PRN/AUX/NUL/COM1-9/LPT1-9), since that's a real OS constraint the
  desktop Tauri backend will actually hit that the browser mock cannot exercise.

## 500-client workspace performance

- Bulk-created 501 clients via the store directly (`createMatter` in a loop): 173ms total for all
  500 creates.
- Client Map table + left sidebar both render all ~500 rows into the DOM at once (confirmed via
  `document.querySelectorAll('[data-testid^="matter-row-"]').length === 501`) — no virtualization/
  windowing.
- Despite that, a live search-filter keystroke against the 501-row list resolved in 18ms
  (`rowsAfterFilter:1`), and general navigation felt immediate. At this scale (500), the lack of
  virtualization is a code-quality note, not a felt performance problem. Not tested at a materially
  larger scale (5,000+) — flagging that as unexplored, not as passing at any scale.
- The Ask tab's client-scope picker does NOT enumerate all clients in a dropdown (it's a fixed set of
  scope buttons: This client / All clients / Email / Documents / Whole practice), so no analogous
  risk there.

## Held up well (for the plain-language summary)

- Workspace state (matters list, settings) persists correctly across a full page reload —
  `localStorage`-backed, confirmed with 500+ clients present after reload.
- No XSS from HTML/script tag injection anywhere it was tried (client names, workflow search box).
- New clients still get a real scoped folder automatically (QA-5 fix from a previous lane holds).
- Emoji/unicode/very-long filenames all rendered correctly with no layout breakage.
- Empty-workspace states (Client Map, Ask, Workflows, and a client's Documents/Email/Meetings/Activity
  tabs) are all clean, on-brand empty states with no console errors or broken layouts.
- The Activity Log's own privacy disclosure ("Stored in your browser, not encrypted. Use the desktop
  app for confidential work.") is an honest, seat-appropriate warning specific to the browser build.
