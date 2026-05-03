# Plugin Runner Sandbox Spike Memo (Stream C2 gate)

**Date:** 2026-05-03
**Branch:** `feature/stream-c-spike`
**Spike commit:** `a88f59ab1904220e34bfcb5ea5726982faaa1bad`
**Test results:** [`2026-05-03-plugin-runner-spike-results.md`](./2026-05-03-plugin-runner-spike-results.md)

## Outcome (one of)

- [x] **All 8 criteria pass, proceed with web-worker plugin runner** (matches spec §6.3 row 1).
- [ ] 1 to 2 criteria fail, pivot to iframe-sandbox + postMessage (spec row 2).
- [ ] Criterion 3 fails (sandbox actually leaks), re-evaluate whether to ship plugin system in v2.0 (spec row 3).
- [ ] 4 to 8 criteria fail, adjust scope (spec row 4).

**Live-browser smoke test confirmed 2026-05-03.** The harness was driven via Playwright against a real Vite + Chromium browser at `/_dev/plugin-spike`. All 8 criteria passed against real `Worker` behaviour, including the two previously-pending: criterion 1 (real worker isolation) and criterion 8 (real `postMessage` round-trip latency). The outcome is no longer conditional.

**Justification.** Criteria 2-7 were already validated through the real bridge / runtime / protocol code paths under the paired-bridge mock. The live-browser run added the missing pieces: criterion 1 confirmed `typeof document` and `typeof window` are both `undefined` inside a real Web Worker (the architectural assumption held); criterion 8 measured 100 round-trips in real Chromium and reported median 0.10 ms, p95 0.20 ms, max 1.40 ms, more than 35x under the 50 ms target's most aggressive interpretation and 500x under its plain reading. No Tauri-CSP issues with blob-URL imports surfaced (Vite served the worker via its `?worker` import; the production path will need re-validation under Tauri's webview, but the Vite path is identical to the dev experience).

## Per-criterion results

| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | Worker isolation | pass (live-browser confirmed 2026-05-03) | Live harness reported "document/window are undefined inside the worker; self is defined." Real Web Worker has no DOM globals, as expected. |
| 2 | Round-trip command | pass | Both string-payload (`{ echo: 'pong' }`) and default-payload returns matched. Real bridge + runtime + protocol code paths exercised. |
| 3 | Permission denial | pass | `workspace.readFile('/etc/passwd')` rejected with structured error `code: 'permission-denied'`. Bridge enforced manifest at API call time. Live harness re-confirmed under real Worker. |
| 4 | Sidebar panel render | pass | `panel-render` emitted by worker, captured by `bridge.onPanelRender`. Live harness reported `id=spike-panel, title="Spike Panel"`. The sandboxed-iframe renderer is wired into the harness component. |
| 5 | Hot-load + reload + unload | pass | Three-phase cycle (load, reload with same source, unload). Live harness: "load + reload + unload completed; bridges terminated cleanly between cycles." |
| 6 | Permission enforcement across plugins | pass | Live harness: permitted plugin returned `"selected text"`; denied plugin got `permission-denied`. Two independent bridges, distinct manifests. |
| 7 | Crash isolation | pass | Live harness measured **63 heartbeat ticks** through sync + async plugin throws. Both sync (`throw new Error`) and async (`Promise.reject`) crashes caught with `code: 'plugin-threw'`. Main thread responsive throughout. |
| 8 | API round-trip latency | pass (live-browser confirmed 2026-05-03) | Live harness, real Chromium Worker, 100 calls, 5 warmup discards, 95 measured: **median 0.10 ms, p95 0.20 ms, max 1.40 ms.** 500x under the 50 ms spec target. |

## Surprises

The implementing groups uncovered four divergences from the original plan. None blocked progress; each is documented for the C3 plan author.

1. **Plugin source-as-string approach.** The plan suggested loading plugin code via dynamic `import()` of a Blob URL. The implementer chose to author the plugin source as a JavaScript template literal in `spike-plugin-permitted.ts` / `spike-plugin-denied.ts` rather than relying on Vite `?raw` imports. This keeps the spike dependency-free at build time and makes the source string trivially shareable between the live bridge factory and the mock test factory. C3 should keep this pattern unless the production runner needs raw asset imports for non-string plugin distribution (TypeScript transpiled bundles, etc.).
2. **`BridgeFactory` signature.** The plan called for `new SpikeAPIBridge({ workerScriptUrl, manifest })`. The shipped signature is `(manifest, hooks) => bridge` where `hooks.onRegisterCommand` lets scenario callers wait for command registration before invoking. This made production wiring (real Worker via Vite `?worker` import) and test wiring (paired-bridge mock) share a single contract, and removed a class of "command not yet registered" race conditions.
3. **Sandboxed-iframe substitution for plugin HTML rendering.** Criterion 4's `sidebar.addPanel({ html })` pipes plugin-emitted HTML to a main-thread renderer. The harness component renders that HTML inside a sandboxed `<iframe sandbox="">` rather than injecting raw markup into the host DOM. This is a security upgrade beyond the plan's wording; the production runner should keep it.
4. **Paired-bridge factory for jsdom.** The plan assumed `happy-dom` or jsdom might support Web Workers. Neither does in the relevant version. The implementer extracted a `tests/helpers/spikeMockFactory.ts` that pairs a `SpikeAPIBridge` with an in-process `SpikePluginRuntime` over in-memory message queues. Both unit and integration tests share this factory. Production code paths inside the bridge and runtime are exercised; only the Worker shell is mocked.

## Recommended path for C3 (sandboxed runner)

The spike validates the following design decisions for the production runner. C3's implementer can take these as given.

- **Worker type:** module worker. Vite's `?worker` import resolves a module worker out of the box and the spike's runtime + bridge already speak that contract. Classic workers offer no win for our use case.
- **Plugin code distribution:** blob URL via `URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))` then dynamic `import()`. Validated in the spike's runtime loader. C3 should still test this under Tauri's CSP early; if blob URLs are blocked in production webview, fall back to the static-URL approach (plugins served from `<workspace>/.projelli/plugins/<id>/index.js` via Tauri's asset protocol) and re-run criterion 3 + 4.
- **Message protocol:** JSON serialize via `SpikeMessageProtocol.encode` / `decode`. Sufficient for all 8 criterion payloads. Structured-clone-direct (no JSON pass) is a future optimisation; not needed at v2.0 launch.
- **Permission caching:** per-call check (current spike behaviour). Permission set is small (~10 in the production manifest), the check is `Array.includes`, and per-call enforcement keeps the audit story honest. Cache-on-init can land later if profiling shows hot-path cost.
- **Error propagation:** structured error variant in the `SpikeMessage` union (`{ kind: 'error', id, code, message }`). Plugin throws surface with `code: 'plugin-threw'`; permission denials with `code: 'permission-denied'`. Both round-tripped cleanly across the bridge boundary in criteria 3, 6, 7.

## Open questions for Jameson

None. All spike-level decisions resolved during execution. C3 plan-writing is gated on the outcome row above; that gate is the only board-level item.

## Next plans to write (now unblocked, awaiting Jameson go-ahead)

Live-browser smoke test confirmed all 8 criteria. Outcome row 1 is final. The following plans are now ready to write on Jameson's signal:

- C3 plan, sandboxed runner production implementation
- C4 plan, marketplace UI
- C5 plan, plugin developer experience
- C6 plan, seed catalog
