# App-layout E2E disposition

Run once against a fresh Vite server at `127.0.0.1:5299` with `--strictPort`,
one worker, and `--retries=0`. This record intentionally does not change
product code or weaken the spec.

| Check in `tests/e2e/app-layout.spec.ts` | Disposition | Evidence |
| --- | --- | --- |
| `app loads and shows workspace selector` | REAL harness/UI mismatch (pre-existing) | `open-existing-workspace` remains in `WorkspaceSelector.tsx:672`, but the browser run never rendered App: it failed in `waitForAppLoad` after `Failed to fetch dynamically imported module: http://127.0.0.1:5299/src/App.tsx`. The selector was therefore not absent or retired; this run could not reach the current UI. |
| `workspace selector has both action buttons` | REAL harness/UI mismatch (pre-existing) | `open-existing-workspace` and `new-workspace` remain at `WorkspaceSelector.tsx:672` and `:712`. It failed at the same pre-render `waitForAppLoad` boundary, before either live control could be queried. |
| `visual snapshot: workspace selector` | REAL harness/UI mismatch (pre-existing) | It failed at the same `waitForAppLoad` boundary before taking its snapshot. The existing selector controls above are not retired identifiers. |
| `spine has exactly the 3 IA rail destinations` | REAL UI/spec mismatch (pre-existing) | The assertion reaches `spine-nav-workflows`, which is absent. Current `Spine.tsx:1-5` says the primary rail is “Home · Clients · Ask”; the captured page rendered those three labels. This test still expects the prior Matters / Ask / Workflows hierarchy. |
| `top bar owns the logo and no longer renders the global Back button` | REAL UI/spec mismatch (pre-existing) | `app-header` remains in `App.tsx:2282`, but the assertion asks for an image named `Lantern`. The live page snapshot names that image `Advisor Prep Hero`, so this is stale branding expectation, not a missing header. |
| `spine no longer renders the old logo image` | PASSES NOW | Rerun on port 5299, no retries: 3 selected checks passed in 5.7 s, including this one. |
| `spine collapse and expand buttons work` | PASSES NOW | Same no-retry rerun passed. |
| `clicking spine tabs switches content` | REAL UI/spec mismatch (pre-existing) | It also stops at absent `spine-nav-workflows`. Workflows is no longer a primary rail destination in the current Home / Clients / Ask navigation; the test’s old route and `associate-home` expectation no longer match the live hierarchy. |
| `visual snapshot: main app in test mode` | PASSES NOW | Same no-retry rerun passed. |

## Runtime-contract deletion proof

The test-mode mock now exports the canonical list of all 22 public
`WorkspaceService` method names and checks each factory result at runtime.
For the proof, `toRecentWorkspace` was temporarily removed from the mock. The
focused test failed with `toRecentWorkspace is callable at runtime: expected
'undefined' to be 'function'`. The method was restored before the succeeding
focused test run.

Generated Playwright artifacts were kept out of the worktree after inspection;
the retained report output lives under `/mnt/devcache/playwright-w2-fix-browser-testmode`.
