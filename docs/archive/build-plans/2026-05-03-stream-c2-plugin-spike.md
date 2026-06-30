# Projelli v2.0 Stream C2: Plugin Runner Sandbox Spike

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a minimal but realistic web-worker-based plugin runner spike that exercises the 8 spike criteria from spec §6.3. The deliverable is a working hello-world plugin running in an isolated worker, an in-app spike harness that operators of the spike can drive interactively, an automated test suite that asserts every spike criterion, and a written go/no-go memo recommending one of the four decision-matrix outcomes.

**This is a hard go/no-go gate.** The remaining Stream C work (C3 sandboxed runner, C4-C5 marketplace UI + dev experience, C6 seed catalog) is blocked behind this spike's outcome. Do not write those plans until the memo lands.

**Branch:** `feature/stream-c-spike`. Branches off `master` (or `feature/foundations` if #18 has not yet merged). Spike work is isolated from C1 templates marketplace; both can proceed in parallel against different branches.

**Why a spike rather than going straight to the runner:** The plugin runner is the highest-risk single component in v2.0. Web Worker isolation has many subtle edges (transferable objects, structured clone vs `postMessage` overhead, error propagation, worker termination races). Validating the approach end-to-end on a hello-world target before committing to the full API surface (C1 plugin manifest + 6.4 API surface, C2 sandboxed runner) avoids burning weeks on an architecture that turns out to fall short on one of the spike criteria.

**Architecture (intentionally minimal):** A single `PluginSpike` page mounted at a hidden dev-only route. The page hosts a `SpikeHarness` component that exposes 8 buttons (one per spike criterion) plus a results panel. Each button dispatches a scenario into a freshly-spawned `Worker` constructed from a bundled spike-plugin script. A thin `SpikeAPIBridge` runs in main thread, a thin `SpikePluginRuntime` runs in the worker. The bridge enforces a single permission (`editor:selection`) to prove enforcement works. AI calls and filesystem writes go through the bridge so we measure round-trip latency. Crash isolation is tested by deliberate `throw` and infinite loop. A second worker is spawned for the multi-instance test.

**Tech Stack:** TypeScript 5 (strict mode), React 18, Vite 5, Vitest, Tauri 2 (no Rust changes needed for the spike — workers run entirely in the webview). Web Worker (module type) instantiated via Vite's `?worker` import.

**Spec reference:** `docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md` Section 6.3.

---

## Spike acceptance criteria (must report on each)

The decision matrix in spec §6.3 keys off these. The harness must produce a pass/fail signal for every one of them, with measured numbers where applicable.

| # | Criterion | Pass signal |
|---|---|---|
| 1 | Plugin runs in a web worker, isolated from main thread | `typeof document` and `typeof window` are `undefined` inside worker, asserted by plugin and reported back to main |
| 2 | Plugin can register a command. Main invokes. Result returned across boundary | Round-trip works for both `void` and `string` returns |
| 3 | Plugin attempting filesystem access without permission FAILS gracefully | Bridge denies the call, plugin's promise rejects with structured error, no crash |
| 4 | Plugin can render a sidebar panel via structured message + main-thread renderer | Worker emits a `panel-render` message, main mounts a React subtree wrapping the structured spec, screenshot proof in spike memo |
| 5 | Plugin loaded from disk at runtime (hot-load), reloaded after edit, unloaded cleanly | Spike harness has [Load], [Reload], [Unload] buttons; worker terminate + URL.revokeObjectURL on unload |
| 6 | Permissions model: declared permissions enforce at API call time | Spike has 2 plugins, one with `editor:selection`, one without. Same call from each: first succeeds, second fails with permission-denied |
| 7 | Plugin crash doesn't crash Projelli | Plugin throws synchronously and from a Promise; harness reports both caught + worker terminated; main thread continues responsive (clock keeps ticking) |
| 8 | Reasonable performance: API call round-trip under 50ms typical | Harness runs 100 round-trips of `getSelection` (no-op call), reports median + p95 + max |

---

## File Structure

### Files to create

| Path | Purpose |
|---|---|
| `src/types/pluginSpike.ts` | Spike-only types: `SpikeMessage`, `SpikePermission`, `SpikeAPI`, `SpikeResult` |
| `src/modules/pluginSpike/SpikeAPIBridge.ts` | Main-thread bridge: routes worker messages, enforces single `editor:selection` permission, owns the worker instance |
| `src/modules/pluginSpike/SpikePluginRuntime.ts` | Worker-side runtime: receives `init`, exposes `api` proxy to plugin code, calls `plugin.activate(api)` |
| `src/modules/pluginSpike/SpikeMessageProtocol.ts` | Shared message-shape definitions + serializer / deserializer |
| `src/modules/pluginSpike/spike-plugin-permitted.ts` | Hello-world plugin built into the spike, declares `editor:selection`. Exercises 8 commands |
| `src/modules/pluginSpike/spike-plugin-denied.ts` | Same plugin minus the `editor:selection` permission. Used for criterion #6 |
| `src/modules/pluginSpike/spike-worker.ts` | Worker entry point: imports `SpikePluginRuntime`, hands off to plugin script. Loaded via Vite `?worker&inline` import |
| `src/components/pluginSpike/PluginSpikePage.tsx` | Top-level page mounted at hidden `/_dev/plugin-spike` route. Hosts harness + results |
| `src/components/pluginSpike/SpikeHarness.tsx` | 8 criterion buttons + per-criterion results card |
| `src/components/pluginSpike/SpikeResultsPanel.tsx` | Live-updating result list with copy-to-clipboard for memo evidence |
| `src/components/pluginSpike/SpikeSidebarPreview.tsx` | Renders a plugin-emitted sidebar panel structured spec into a real React subtree (criterion #4) |
| `src/components/pluginSpike/PerformanceReport.tsx` | Histogram of round-trip times (criterion #8) |
| `tests/unit/pluginSpike/SpikeAPIBridge.test.ts` | Bridge unit tests: routing, permission denial, worker termination on uninstall |
| `tests/unit/pluginSpike/SpikePluginRuntime.test.ts` | Runtime unit tests: command registration, error propagation across boundary |
| `tests/integration/pluginSpike/all-criteria.test.ts` | Drives the harness programmatically and asserts pass/fail for all 8 criteria |
| `docs/superpowers/spikes/2026-05-03-plugin-runner-spike-memo.md` | Final go/no-go memo (written after harness runs clean). Template provided in this plan |

### Files to modify

| Path | Change |
|---|---|
| `src/App.tsx` (or routing config) | Mount `/_dev/plugin-spike` route only when `import.meta.env.DEV` or feature flag set. Spike does not ship to production |
| `vite.config.ts` | If needed for `?worker&inline` import, ensure web worker bundling is enabled |
| `tsconfig.json` | Add `"WebWorker"` to `lib` if not already present |

### Files to NOT modify

- Any production code outside `src/modules/pluginSpike/` and `src/components/pluginSpike/`
- C1 templates marketplace files
- Other streams' files
- `tauri.conf.json` (spike runs in webview only)

---

## Task Decomposition

There are 6 task groups. Within each group, tasks run sequentially. Across groups, the dependency order is: protocol + types (Group I) before bridge + runtime (Group II) before harness UI (Group III) before scenario implementation per criterion (Group IV) before automated test (Group V) before memo writeup (Group VI).

- Group I: Message protocol + types
- Group II: Bridge + worker runtime
- Group III: Spike harness UI shell
- Group IV: Per-criterion scenarios
- Group V: Automated end-to-end test
- Group VI: Memo writeup + go/no-go recommendation

---

## Group I: Message protocol + types

- [ ] **Task 1.1** — Define `SpikeMessage` discriminated union in `src/types/pluginSpike.ts`. Variants: `init`, `register-command`, `invoke-command`, `command-result`, `api-call`, `api-result`, `panel-render`, `notify`, `error`. Each carries a correlation `id` for round-trip matching plus the variant payload.
- [ ] **Task 1.2** — Define `SpikePermission = 'editor:selection'` (just one, sufficient for criterion #6) and `SpikeAPI` interface (subset of the full plugin API: `commands.register`, `editor.getSelection`, `workspace.readFile` (always denied for the spike), `notify.info`, `sidebar.addPanel`).
- [ ] **Task 1.3** — Implement `SpikeMessageProtocol.ts` with `encode(msg)` + `decode(raw)` using JSON. (Structured-clone-friendly. Spike avoids transferables to keep the runtime simple — that optimization can land in C2 production runner.)
- [ ] **Task 1.4** — Tests: `tests/unit/pluginSpike/SpikeMessageProtocol.test.ts` covering encode round-trip + invalid message rejection.

## Group II: Bridge + worker runtime

- [ ] **Task 2.1** — Implement `SpikeAPIBridge` class. Constructor: `(workerScriptUrl: string, manifest: { permissions: SpikePermission[] })`. Spawns `new Worker(workerScriptUrl, { type: 'module' })`. Holds a `pendingCalls: Map<id, { resolve, reject }>` for round-trip matching.
- [ ] **Task 2.2** — Bridge: `sendInit(plugin: { code: string })` posts an `init` message with the plugin script as a string. Worker eval'd or, better, plugin loaded via `URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))` and dynamic `import()`.
- [ ] **Task 2.3** — Bridge: `invokeCommand(commandId)` posts `invoke-command`, returns a Promise that resolves on `command-result` or rejects on `error`.
- [ ] **Task 2.4** — Bridge: `handleApiCall(msg: SpikeMessage)` checks `manifest.permissions.includes(msg.permissionRequired)`. If yes, executes the call against main-thread state (mock `getSelection` returning a fixed string for the spike). If no, posts `error` back with `code: 'permission-denied'`.
- [ ] **Task 2.5** — Bridge: `handlePanelRender(msg)` raises a `'panel-render'` event the React UI subscribes to.
- [ ] **Task 2.6** — Bridge: `terminate()` calls `worker.terminate()`, cancels all pending calls with a `unloaded` rejection, revokes the object URL.
- [ ] **Task 2.7** — Implement `SpikePluginRuntime` (worker-side). Listens for `init`, dynamic-imports the plugin code, calls `plugin.activate(api)` where `api` is a proxy that posts `api-call` for every method and awaits `api-result`. Re-throws on `error` responses.
- [ ] **Task 2.8** — Worker entry `spike-worker.ts` mounts the runtime. Handles uncaught errors (`self.onerror` + `unhandledrejection`) by posting structured `error` messages.
- [ ] **Task 2.9** — Tests: `SpikeAPIBridge.test.ts` covers send/receive, permission denial, terminate cleanup. `SpikePluginRuntime.test.ts` covers register-command + api-call flow with a mock worker scope.

## Group III: Spike harness UI shell

- [ ] **Task 3.1** — Add `PluginSpikePage` mounted at `/_dev/plugin-spike` (gated by `import.meta.env.DEV` or `localStorage.getItem('projelli:spike') === '1'`). Layout: left column = 8 numbered criterion cards with [Run] buttons; right column = `SpikeResultsPanel`.
- [ ] **Task 3.2** — Implement `SpikeHarness`. Holds harness state: `Map<criterionId, { status: 'idle' | 'running' | 'pass' | 'fail'; details: string; metrics?: object }>`. [Run all] button cycles through criteria sequentially.
- [ ] **Task 3.3** — Implement `SpikeResultsPanel`. Live updates as criteria complete. [Copy memo block] button copies a markdown-formatted result section to clipboard for paste-into-memo.
- [ ] **Task 3.4** — Implement `SpikeSidebarPreview`. Renders panel structured spec: `{ id, title, html?: string, components?: ComponentTree }` (limit to plain HTML for the spike).
- [ ] **Task 3.5** — Implement `PerformanceReport`. Renders the criterion-8 histogram from a passed-in `number[]` of round-trip durations. Median + p95 + max as text.

## Group IV: Per-criterion scenarios

- [ ] **Task 4.1** — Build `spike-plugin-permitted.ts`: a single plugin that, on `activate`, registers 8 commands `criterion-1` through `criterion-8`. Each command implements its corresponding scenario:
  - `criterion-1`: returns `{ document: typeof document, window: typeof window }` to confirm both are `undefined`.
  - `criterion-2`: registers + invokes a follow-up command, returns its result.
  - `criterion-3`: calls `api.workspace.readFile('/x')` and reports the rejection error structure.
  - `criterion-4`: calls `api.sidebar.addPanel({ id: 'spike-panel', title: 'Spike', html: '<p>hello</p>' })`.
  - `criterion-5`: returns `{ activated: true }` (host drives the load/unload/reload cycle around it).
  - `criterion-6`: handled by host running same command across permitted + denied plugins.
  - `criterion-7`: throws synchronously OR returns a rejected Promise (host parameterizes via `invoke-command` payload).
  - `criterion-8`: host invokes `criterion-2`-style ping 100x, reports timings.
- [ ] **Task 4.2** — Build `spike-plugin-denied.ts`: same plugin minus `editor:selection` permission. Command `criterion-6` calls `api.editor.getSelection()` and surfaces the resulting permission-denied error.
- [ ] **Task 4.3** — Wire each `SpikeHarness` button to its scenario. For criterion #5: harness creates a bridge, sends init, then on [Reload] terminates + recreates with same code, asserts no leaked workers via `performance.measureUserAgentSpecificMemory()` if available else just sequential cleanups; on [Unload] terminates and asserts no further messages received.
- [ ] **Task 4.4** — For criterion #7: harness installs a `setInterval(() => mainThreadHeartbeatCount++, 16)` for 1 second around the throw scenario. Assert heartbeat increments through the throw.
- [ ] **Task 4.5** — For criterion #8: harness uses `performance.now()` deltas across 100 round-trips, ignores first 5 as warmup, computes median/p95/max from the rest.

## Group V: Automated end-to-end test

- [ ] **Task 5.1** — `tests/integration/pluginSpike/all-criteria.test.ts` constructs a virtual harness in vitest's jsdom (or happy-dom) environment. If web workers aren't available in the test environment, mock them with the same message-protocol contract.
- [ ] **Task 5.2** — Each criterion is a separate test case. Each asserts the expected pass-signal from the criteria table above. Use realistic timeouts (1 second per criterion is generous).
- [ ] **Task 5.3** — Performance test (criterion #8) asserts median round-trip < 50ms in CI. If CI hardware is too slow, gate via env var `SPIKE_PERF_THRESHOLD_MS` defaulting to 50; CI sets to 200 if needed but logs the actual median.
- [ ] **Task 5.4** — Run the full test once locally; fix any flakes; record the result. Then run 5 times in a row to confirm stability.

## Group VI: Memo writeup + go/no-go recommendation

- [ ] **Task 6.1** — Run the harness in the live app, click [Run all], capture the markdown-export from `SpikeResultsPanel`. Save raw output as `docs/superpowers/spikes/2026-05-03-plugin-runner-spike-results.md`.
- [ ] **Task 6.2** — Author `docs/superpowers/spikes/2026-05-03-plugin-runner-spike-memo.md`. Use the template below.

### Memo template

```markdown
# Plugin Runner Sandbox Spike Memo (Stream C2 gate)

**Date:** YYYY-MM-DD
**Branch:** feature/stream-c-spike
**Spike commit:** <sha>
**Test results:** <link to results.md>

## Outcome (one of)

- [ ] All 8 criteria pass — proceed with web-worker plugin runner (matches spec §6.3 row 1).
- [ ] 1 to 2 criteria fail — pivot to iframe-sandbox + postMessage (spec row 2). List which.
- [ ] Criterion 3 fails (sandbox actually leaks) — re-evaluate whether to ship plugin system in v2.0 (spec row 3).
- [ ] 4 to 8 criteria fail — adjust scope: drop sidebar panels OR slower API tolerated OR no hot-reload in v2.0 (spec row 4). List the cuts.

## Per-criterion results

| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | Worker isolation | pass / fail | ... |
| 2 | Round-trip command | pass / fail | ... |
| 3 | Permission denial | pass / fail | ... |
| 4 | Sidebar panel render | pass / fail | screenshot path |
| 5 | Hot-load + unload | pass / fail | ... |
| 6 | Permission enforcement across plugins | pass / fail | ... |
| 7 | Crash isolation | pass / fail | heartbeat measured: N ticks during throw |
| 8 | API round-trip latency | pass / fail | median Xms, p95 Yms, max Zms over 100 calls |

## Surprises

What surfaced that the spec did not anticipate?

## Recommended path for C3 (sandboxed runner)

Concrete: which design decisions does the spike validate or invalidate?

- Worker type: classic vs module — pick one and justify
- Plugin code distribution: blob URL vs static URL — pick
- Message protocol: JSON serialize vs structured-clone direct — pick
- Permission caching: per-call check vs cached on init — pick
- Error propagation: structured error vs string — pick

## Open questions for Jameson

(Only escalate to him if a board-level decision surfaces. Tactical decisions resolve in the recommendation above.)

## Next plans to write (only after Jameson approves the outcome)

If outcome row 1 (proceed): write C3 sandboxed runner plan, C4 marketplace UI plan, C5 dev experience plan, C6 seed catalog plan.
If outcome row 2 (iframe pivot): rewrite C3 against iframe-sandbox + postMessage. Adjust spec §6.5 accordingly.
If outcome row 3 (re-evaluate): escalate to Jameson. Plugin system may be cut from v2.0.
If outcome row 4 (scope cut): rewrite C3 with explicit cuts. Adjust spec §6.4 + §6.5.
```

- [ ] **Task 6.3** — Surface the memo to Jameson via terminal output: print path, summarize outcome row, list the next plans queued. Do NOT auto-write the next plans; that's the gate.

---

## Acceptance criteria (for the spike itself, not the plugin runner)

- The 8 criterion harness buttons all return a structured pass/fail with measurable evidence.
- The automated integration test passes locally and in CI.
- The memo is written, includes per-criterion results, and recommends a concrete path forward.
- Jameson reviews the memo and approves the outcome before any C3-C6 plan is written.
- The spike code lives entirely under `src/modules/pluginSpike/` and `src/components/pluginSpike/`. None of it ships to the production build (gate via `import.meta.env.DEV` and / or feature flag).
- A PR is opened titled `spike(stream-c): plugin runner sandbox validation`. PR body links to the memo. PR can stay open until Jameson approves; merge optional (spike code may be deleted post-decision, kept as historical reference under `docs/superpowers/spikes/`, or evolved into the C3 production runner).

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Worker behavior differs between dev (Vite) and prod (Tauri webview) | Run the harness in both. Memo records both result sets if they diverge |
| jsdom / happy-dom doesn't support web workers, blocking automated test | Fall back to mocking workers with the same message-protocol contract; smoke-test in real browser via the harness |
| Performance criterion fluctuates wildly in CI | Threshold gated by env var (default 50ms local, 200ms CI). Memo records actual numbers, not pass/fail only |
| Plugin code distribution via blob URL has CSP issues in production webview | Test under Tauri's CSP. If blob: blocked, switch to static-URL approach (plugins served from `<workspace>/.projelli/plugins/<id>/index.js` via Tauri's asset protocol) and re-run the spike |
| Spike scope creeps into a full plugin runner | This plan deliberately bounds scope: 1 permission, 8 scenarios, hidden dev route. Reviewers reject any PR that pulls in C3 code |

---

## Out of scope (deferred to C3 and beyond)

- Full plugin manifest schema (only the spike's minimal `permissions` field)
- Multi-permission API (only `editor:selection`)
- Real `editor.getSelection` integration (spike returns a fixed string)
- Workspace filesystem permission (spike denies always for criterion #3)
- AI invoke permission + cost accounting
- Plugin install / uninstall (spike loads plugin script in-memory only)
- Marketplace UI (lives in C3/C4)
- Settings page registration
- Toolbar button registration

---

## Definition of done

- All 6 task groups completed.
- Automated test passes in CI.
- Memo lands at `docs/superpowers/spikes/2026-05-03-plugin-runner-spike-memo.md` with concrete outcome row selected.
- Spike PR opened, links to memo.
- Jameson notified with a one-screen summary: outcome row + per-criterion table + recommendation.
- No C3-C6 plan-writing has started (that is the gate).

---

## Dispatch hints (for the executing agent)

- Worktree: `cd ~/projelli && git worktree add ~/projelli-worktrees/stream-c-spike -b feature/stream-c-spike master` (or off `feature/foundations` if #18 not yet merged). Then `npm install`.
- Group sizes here are small; one or two implementer dispatches per group is appropriate. Combine Groups I + II in a single dispatch if 13 tasks fit; split if not.
- Pass the absolute path to this plan: `/home/jameson/projelli/docs/superpowers/plans/2026-05-03-stream-c2-plugin-spike.md`.
- After Group V (automated tests) passes, the executing agent must run the harness manually in `npm run tauri:dev` to capture criterion #4's panel-render screenshot. That step requires Jameson's hands or a desktop CI runner. If neither is available, mark criterion #4 as "manual verification pending" in the memo and proceed.
- The memo's outcome-row checkbox is the gate. Do not write C3-C6 plans before Jameson confirms the outcome.
