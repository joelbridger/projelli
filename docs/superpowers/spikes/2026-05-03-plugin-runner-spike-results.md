# Plugin Runner Sandbox Spike, Test Results

**Run timestamp:** 2026-05-03 20:38 local
**Spike branch:** `feature/stream-c-spike`
**Spike commit (HEAD):** `a88f59ab1904220e34bfcb5ea5726982faaa1bad`
**Test command:** `npx vitest run tests/integration/pluginSpike/all-criteria.test.ts --reporter=verbose`

## Summary

| Tests | Status | Duration |
|---|---|---|
| 8 / 8 | passed | 1.67 s |

All 8 spike criteria pass under jsdom + the paired-bridge mock factory. Real-Worker behaviour is not exercised in this run (jsdom has no Web Worker implementation), so the numbers below come from the in-memory paired bridge that mirrors the message protocol but skips real `postMessage` clone + IPC overhead. See the memo for what this implies for criterion 1 and criterion 8.

## Per-criterion results

| # | Criterion | Result | Key metric / detail |
|---|---|---|---|
| 1 | Worker isolation (`document` / `window` undefined inside worker) | pass (mock) | Mock fixture reports both as `'undefined'`. jsdom defines them; real isolation needs live-browser confirmation. |
| 2 | Round-trip command, both `string` and default returns | pass | Round-trip succeeded for `criterion-2` payload + default invocation. |
| 3 | Filesystem access denied with structured error | pass | `workspace.readFile('/etc/passwd')` rejected with `code: 'permission-denied'`. |
| 4 | Sidebar `panel-render` produces `sidebarSpec` of expected shape | pass | Captured spec: `{ id: 'spike-panel', title: 'Spike Panel', html: '<p>hello from the plugin sandbox</p>' }`. |
| 5 | Hot-load + reload + unload cycle | pass | First load activated, reload activated, post-`terminate()` `invokeCommand` rejected synchronously. |
| 6 | Permission enforcement across two plugins (permitted vs denied) | pass | Permitted plugin returned the mock selection string; denied plugin's call rejected with `code: 'permission-denied'`. |
| 7 | Crash isolation (sync throw + async rejection do not crash main thread) | pass | Heartbeat ticked through both throws over the 1 s window. Test asserted `heartbeatTicks >= 5`. Group V observed approximately 62 ticks during the live throw window. |
| 8 | API round-trip latency (100 calls, 5 warmup discards) | pass | median 0.011 ms, p95 0.019 ms, max 0.026 ms over 95 measured samples (threshold 50 ms). NOTE: paired-bridge microtask deferral, not real Worker `postMessage`. |

## Raw test output

```
 RUN  v4.1.3 /home/jameson/projelli-worktrees/stream-c-spike

 ✓ tests/integration/pluginSpike/all-criteria.test.ts > plugin spike, all 8 criteria (automated) > criterion 1: worker isolation, document/window report as undefined 3ms
 ✓ tests/integration/pluginSpike/all-criteria.test.ts > plugin spike, all 8 criteria (automated) > criterion 2: round-trip command returns expected payload 1ms
 ✓ tests/integration/pluginSpike/all-criteria.test.ts > plugin spike, all 8 criteria (automated) > criterion 3: filesystem access denied with structured error 1ms
 ✓ tests/integration/pluginSpike/all-criteria.test.ts > plugin spike, all 8 criteria (automated) > criterion 4: panel-render produces a sidebarSpec of expected shape 1ms
 ✓ tests/integration/pluginSpike/all-criteria.test.ts > plugin spike, all 8 criteria (automated) > criterion 5: hot-load + reload + unload cycle completes cleanly 1ms
 ✓ tests/integration/pluginSpike/all-criteria.test.ts > plugin spike, all 8 criteria (automated) > criterion 6: permitted plugin succeeds, denied plugin fails 1ms
 ✓ tests/integration/pluginSpike/all-criteria.test.ts > plugin spike, all 8 criteria (automated) > criterion 7: plugin throws do not crash main thread; heartbeat continues 1005ms
stdout | tests/integration/pluginSpike/all-criteria.test.ts > plugin spike, all 8 criteria (automated) > criterion 8: 100 round-trips, median < threshold
[criterion-8] median=0.011ms p95=0.019ms max=0.026ms threshold=50ms n=95

 ✓ tests/integration/pluginSpike/all-criteria.test.ts > plugin spike, all 8 criteria (automated) > criterion 8: 100 round-trips, median < threshold 3ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  20:38:22
   Duration  1.67s (transform 69ms, setup 46ms, import 256ms, tests 1.02s, environment 265ms)
```

## Test-environment notes

- **Worker substrate:** jsdom has no `Worker` implementation. The test wires a `SpikeAPIBridge` to an in-process `SpikePluginRuntime` via two in-memory listener queues, deferring each `postMessage` through `queueMicrotask` to mirror real Worker async semantics. This validates the bridge + runtime + protocol modules end-to-end, but does NOT validate real Worker isolation or real `postMessage` latency.
- **Plugin source distribution:** The runtime accepts a JS source string and (in production) wraps it in `URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))` for dynamic `import()`. The mock loader short-circuits this by mapping the two known source strings to in-memory TS fixtures. Same `activate(api, ctx)` shape, same registered command names.
- **Stability:** Test is structured to be flake-free across 5 consecutive runs (per the file header). Live re-run confirmed pass on the run captured above. No retry harness needed.
