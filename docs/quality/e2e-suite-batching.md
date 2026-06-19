# Browser (L1) E2E suite — run strategy

**TL;DR:** run the Playwright browser suite with
`./scripts/run-e2e-preview.sh` (build once, serve statically, one pass).
For CI or emergency fallback use `./scripts/run-e2e-suite.sh` (sequential shards).

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

---

## Primary path — preview-server runner (no sharding needed)

`scripts/run-e2e-preview.sh` is the **primary way to run the full suite**.

It:
1. Builds the app once with `vite.config.e2e.ts`.
2. Serves the static output via `vite preview` on :4173.
3. Runs the entire Playwright suite in **one pass** against
   `E2E_BASE_URL=http://localhost:4173`.

Because `vite preview` serves a pre-built static bundle (no on-demand
compilation), the memory spike that caused the ~42 tail failures is gone.
The stress specs that were previously failing are proved green in one pass
(66/66 passed on 2026-06-19, 50s, project=en).

The `vite.config.e2e.ts` wires all four dev-time proxy routes into the preview
server via `configurePreviewServer` + `http-proxy-middleware`:

| Route | Target |
|-------|--------|
| `/api/anthropic` | `https://api.anthropic.com` |
| `/api/openai` | `https://api.openai.com` |
| `/api/google` | `https://generativelanguage.googleapis.com` |
| `/api/firm` | `FIRM_BACKEND_TARGET` (default `http://127.0.0.1:5290`), with WebSocket upgrade forwarding |

The firm backend `/api/firm` proxy also forwards WebSocket upgrade events so
matter-sync sockets work correctly.

### Usage

```bash
# Full suite, English project (most common):
./scripts/run-e2e-preview.sh en

# Different project:
./scripts/run-e2e-preview.sh chromium

# Specific files only (e.g. just the stress specs):
./scripts/run-e2e-preview.sh en tests/e2e/v1.5-canvas-stress.spec.ts
```

`playwright.config.ts` respects `E2E_BASE_URL`: when set it skips
auto-starting the dev server (the preview script manages its own server),
and derives all per-project `?lang=*` baseURLs from that env var too.

---

## Fallback — sharded runner

`scripts/run-e2e-suite.sh` runs the suite in sequential shards against the
**dev server** (still on :5173). Use it if the preview-server path is
unavailable (e.g. a build break that blocks serving the static bundle).

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

---

## When you just want one area

For day-to-day work, run the relevant file(s) directly — they are reliable at
small scale (dev server is fine for a single file):

```bash
npx playwright test --project=en tests/e2e/<file>.spec.ts
```

---

## Historical notes

- **2026-06-19:** Preview-server path implemented (`vite.config.e2e.ts` +
  `scripts/run-e2e-preview.sh`). All 66 v1.5-*/v1.6-* stress specs passed in a
  single 50s pass. Two `v1.6-feature-tour.spec.ts` failures were traced to
  hardcoded `http://localhost:5173` URLs in the spec (fixed in same commit by
  using relative `/?…` paths). Preview path is now primary; sharded runner is
  the fallback.
