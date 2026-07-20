# Boot-gate TDZ dev-fix — evidence

Branch: `feat/boot-gate-tdz-devfix` · Fix commit: `664510c93` · Base: `426a9b951`

## Root cause
`selection-authority-boot-gate` ON + a returning user's persisted matter data
(`lantern:matters`) crashed at boot with
`ReferenceError: Cannot access 'useClientContextStore' before initialization`.
`matterStore`'s persist hydration queues a selection rehydration through the
retired-writer bridge; `clientContextStore`'s top-level
`registerSelectionWriterBridge(...)` flushes that queue synchronously during
module evaluation, and the flush read the `useClientContextStore` `const` while
it was still declared at the BOTTOM of the file (temporal dead zone).
**Not dev-only — the production bundle crashed identically** (browser repro +
packaged-app bench repro). Trigger = flag ON + persisted data; flag OFF is clean.

## Fix
Pure declaration reorder: `useClientContextStore` moved up to immediately after
the underlying store is created, before any code that can run during module
evaluation. No change to the gate's early execution, fail-closed behaviour,
sealing, provenance, or flag default. `.env.production` untouched.

## Regression test (`src/platform/client-context/bootGateModuleInit.test.ts`)
Reproduces the exact seam deterministically (queue a rehydration through a fresh
bridge, then load the barrel so registration flushes it during module eval).
- **base-fail proof** (`base-fail-proof.txt`): at `426a9b951` the import rejects
  with the TDZ at `clientContextStore.ts:1194` (tests a + b fail).
- with the fix: all 3 pass. (a) no-TDZ boot, (b) fail-closed phantom hint boots
  to BLOCKED (never the phantom selection, routed through the bridge),
  (c) flag-OFF dark-path control.

## Browser evidence matrix (fixed build)
| Environment | Flag | Persisted matters | Result |
|---|---|---|---|
| Dev server | ON | yes | BOOTS CLEAN (`fixed-dev-on.png`) — was CRASH at base |
| Prod preview (baked flag) | ON | yes | BOOTS CLEAN (`fixed-prod-on.png`) — was CRASH at base |
| Dev server | OFF | yes | BOOTS CLEAN (`fixed-dev-off.png`) — control |
| Prod preview | OFF | yes | BOOTS CLEAN (`fixed-prod-off.png`) — control |

All four: 0 page errors, 0 TDZ matches, `#root` ~33k chars of real app content.

## Verify results
- Full `npx vitest run`: **9323 passed / 29 skipped / 1 failed** — the 1 failure
  is `crm-workflows/workflowDependentDueCompletionRegistration.test.ts`
  "Test timed out in 5000ms" under box load ~30-33 (70 vitest/eslint procs); it
  **passes in isolation with a generous timeout** and does not touch
  client-context. Environmental (INCONCLUSIVE-under-load), not a defect, not
  caused by this change. My 3 new tests pass within the full run.
  (`full-suite-summary.txt`)
- typecheck: PASS · typecheck:tests: PASS · boundaries:check: PASS ·
  handle-guard: PASS · arch-dag-guard: PASS · i18n-snapshot: PASS ·
  lint:gate: PASS (no ESLint regression).
- self-check receipt (`../self-check-receipt-664510c939d9.txt`): binds
  `664510c93`; **overall INCONCLUSIVE** solely because `gate:changed` hit its
  300s step-timeout under load 33 (exit 124, mid-ESLint-gate). Every other
  receipt step PASS; both components of the timed-out step verified green
  independently (lint:gate PASS + changed tests PASS).
