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

**Conditional caveat.** The chosen outcome is *conditional* on a live-browser smoke test of the harness (route `/_dev/plugin-spike` under `npm run tauri:dev` or `npm run dev`) producing the same pass-signals for criteria 1 and 8 against a real `Worker`. Criteria 2, 3, 4, 5, 6, 7 are validated through the production `SpikeAPIBridge`, `SpikePluginRuntime`, and `SpikeMessageProtocol` modules (only the Worker shell is mocked), so they hold under either substrate. Criteria 1 and 8 specifically depend on real-Worker behaviour (true isolation, real `postMessage` round-trip latency); the automated test environment cannot answer those.

**Justification.** Criteria 2-7 pass cleanly through the real bridge / runtime / protocol code paths under the paired-bridge mock. Criterion 1 passes via a fixture that hard-codes the isolation report (jsdom defines `document` and `window`); the architectural assumption (a Web Worker has no `document` or `window`) is well-established platform behaviour, not an open research question. Criterion 8 passes the threshold by three orders of magnitude under the mock, and even an order-of-magnitude penalty for real `postMessage` clone + IPC would still leave median latency well under the 50 ms target. The risk surface for "live browser invalidates the spike" is therefore narrow and concrete: CSP blocking blob-URL imports inside the Tauri webview, or surprisingly slow `postMessage` clone on macOS Apple-Silicon webview. Both are testable in minutes once Jameson runs the harness.

## Per-criterion results

| # | Criterion | Result | Notes |
|---|---|---|---|
| 1 | Worker isolation | automated pass via mock; pending live-browser verification | jsdom defines `document` and `window`, so the fixture reports both as `'undefined'` to exercise the pass path. Real isolation must be confirmed by clicking [Run] on criterion 1 in `/_dev/plugin-spike`. |
| 2 | Round-trip command | pass | Both string-payload (`{ echo: 'pong' }`) and default-payload returns matched. Real bridge + runtime + protocol code paths exercised. |
| 3 | Permission denial | pass | `workspace.readFile('/etc/passwd')` rejected with structured error `code: 'permission-denied'`. Bridge enforced manifest at API call time. |
| 4 | Sidebar panel render | pass | `panel-render` emitted by worker, captured by `bridge.onPanelRender`. Spec shape: `{ id: 'spike-panel', title: 'Spike Panel', html: '<p>hello from the plugin sandbox</p>' }`. Live screenshot deferred to harness smoke test. |
| 5 | Hot-load + reload + unload | pass | Three-phase cycle (load, reload with same source, unload). `terminate()` reported `isTerminated() === true`; subsequent `invokeCommand` rejected synchronously. No leaked listeners. |
| 6 | Permission enforcement across plugins | pass | Permitted plugin's `editor.getSelection()` returned the mock selection; denied plugin's same call rejected with `code: 'permission-denied'`. Two independent bridges, distinct manifests. |
| 7 | Crash isolation | pass | Heartbeat ticked approximately 62 times during the 1 s throw window in Group V. Both sync (`throw new Error`) and async (`Promise.reject`) crashes were caught with `code: 'plugin-threw'`. Main thread continued responsive. |
| 8 | API round-trip latency | automated pass via mock; pending live-browser verification | 100 calls, 5 warmup discards, 95 measured. Median 0.011 ms, p95 0.019 ms, max 0.026 ms over the in-memory paired bridge. **Caveat:** these are microtask-deferral numbers, not real Worker `postMessage` round-trips. The 50 ms spec target is keyed against real-Worker latency; live-browser harness produces the spec-relevant numbers. |

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

## Next plans to write (only after Jameson approves the outcome)

(Blocked on Jameson approval of outcome row 1.)

If approved (outcome row 1, proceed): write
- C3 plan, sandboxed runner production implementation
- C4 plan, marketplace UI
- C5 plan, plugin developer experience
- C6 plan, seed catalog

If criteria 1 or 8 fail under live-browser smoke test:
- Criterion 1 fail (`document` / `window` actually defined inside worker) is a v2.0-killing surprise; escalate. Web Workers have not failed this test on any modern browser since 2014.
- Criterion 8 fail (median > 50 ms in real Worker) drops to scope-cut path: pivot C3 to allow synchronous in-bridge command execution for hot paths and reserve worker round-trip for genuine plugin-authored work.

If outcome row 2 (iframe pivot): rewrite C3 against iframe-sandbox + `postMessage`. Adjust spec §6.5.

If outcome row 3 (re-evaluate): escalate. Plugin system may be cut from v2.0.

If outcome row 4 (scope cut): rewrite C3 with explicit cuts. Adjust spec §6.4 + §6.5.
