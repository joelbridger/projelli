# Browser (L1) E2E suite — run it in batches

**TL;DR:** run the Playwright browser suite with
`./scripts/run-e2e-suite.sh` (sequential shards), not as one giant
`npx playwright test` invocation. The single-invocation run reds ~42 tests
that are not actually broken.

## What was happening

Running all ~254 browser tests in ONE `npx playwright test --project=en`
process deterministically failed a fixed ~42 tests at the **tail** of the run
(the heavy `v1.5-*` / `v1.6-*` "stress" specs, which sort last). Every failure
was a `toBeVisible()` / "element not found" timeout.

We proved it is **full-suite-scale interference**, not broken tests and not a
product bug:

- The same specs **pass when run alone or in small groups** (e.g. one file →
  green; the whole suite in 6 shards → green).
- A **brand-new dev server** produced the exact same 42 failures, so it is not
  a stale long-lived Vite server.
- `--workers=4` gave the same 42 as the default, so it is not simply worker
  count.

The cause is cumulative pressure over a long parallel run on this box (the
single Vite dev server compiling modules on demand + browser/worker memory
growth), which starves the last specs of their visibility timeouts. Splitting
the run into several short, separate Playwright processes reclaims memory
between shards and keeps every shard small enough to stay green.

> Note: this is distinct from **genuinely stale tests**. A separate pass
> repaired ~8 `v1.5-*` spec files that failed *even alone* because they
> navigated to pre-3.0 settings screens that the 3.0 redesign moved (Memory →
> Settings ▸ AI & Privacy ▸ Memory; MCP/Ollama → the Account ▸ Connections
> window). Those are real fixes, already merged. Batching is only for the
> remaining scale flakiness.

## How to run it

```bash
# Whole suite, English project, 6 sequential shards (default):
./scripts/run-e2e-suite.sh

# Pick a project and/or shard count:
./scripts/run-e2e-suite.sh en 6
./scripts/run-e2e-suite.sh chromium 4
```

The script reuses a dev server if one is already on :5173 (and leaves it
running); otherwise it starts one for the run and stops it at the end. It exits
non-zero if any shard fails.

## When you just want one area

For day-to-day work, run the relevant file(s) directly — they are reliable at
small scale:

```bash
npx playwright test --project=en tests/e2e/<file>.spec.ts
```

## Future option (not done)

A deeper fix would remove the dev-server-under-load variable entirely by
testing against a built/preview server instead of `npm run dev`. That is a
larger change (the dev server's `/api/*` proxies that some specs rely on would
need to be reproduced for `vite preview`), so for now the batched runner is the
supported way to get a clean full-suite pass.
