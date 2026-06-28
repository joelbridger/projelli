# Troubleshooting failing tests

> A field guide for when a Keepance test goes red: the three test layers
> (Vitest, Playwright E2E, Rust), the failure modes that bite most often, and how
> to diagnose each. Written for a developer (human or AI) staring at a red gate.
> Commands + config references were checked against the repo on 2026-06-28. For
> the wider testing picture start at [README.md](./README.md); for how the gate
> is wired see [DEVELOPER_ONBOARDING.md](../operations/DEVELOPER_ONBOARDING.md).

The pre-merge gate runs three suites — **Vitest** (frontend unit/integration),
**Rust** (`cargo test`), and **Playwright** (browser E2E) — plus typecheck and
the ESLint regression gate. Each fails differently. Start by reproducing the one
that's red in isolation, not the whole gate.

```bash
npm run typecheck                                   # 1. types
npx vitest run                                      # 2. frontend unit/integration
cd src-tauri && CI=1 cargo test --workspace --locked  # 3. Rust
bash scripts/run-e2e-preview.sh                     # 4. browser E2E (chromium)
```

The golden rule (the repo's `diagnosing-bugs` skill): **build the smallest fast
command that reproduces the failure before theorizing.** Run the one failing
test file, not the suite.

---

## Vitest (frontend unit/integration)

Config: [`vitest.config.ts`](../../vitest.config.ts) — `jsdom` environment,
globals on, setup file [`tests/setup.ts`](../../tests/setup.ts). Run one file or
one test:

```bash
npx vitest run tests/unit/some-file.test.tsx        # one file
npx vitest run -t "name of the test"                 # by test name
npx vitest tests/unit/some-file.test.tsx             # watch one file
```

### Common failure modes

**1. "X is not a function" / a render throws in jsdom.** jsdom doesn't implement
everything a real browser does, so `tests/setup.ts` polyfills the gaps:
`scrollIntoView`, pointer-capture (Radix menus need it to open under
`fireEvent`), `Range.getClientRects` (CodeMirror's measure phase),
`Blob.arrayBuffer` (docx serialization), `DOMMatrix` and `Promise.withResolvers`
(pdf.js on Node 20). **If you hit a new "not implemented in jsdom" error, the fix
is usually another small polyfill in `tests/setup.ts`, not a change to your
code.** Check that file first — the existing polyfills explain the pattern.

**2. A cloud-send / AI test is unexpectedly blocked.** The cloud-egress guard is
**fail-closed**: it blocks unless the *persisted* confidentiality mode reads
`direct`/`assured`. `tests/setup.ts` seeds `keepance:settings` with
`confidentialityMode: 'direct'` before each test so ordinary cloud-send tests
aren't blocked. Privacy / fail-closed tests deliberately override this (they
write their own value or clear the key). So: if your cloud test is blocked, check
whether something cleared/overrode that localStorage key; if your privacy test
*isn't* blocking when it should, make sure it actually overrode the default.

**3. A component renders raw i18n keys (`"settings.title"`) instead of text.**
`tests/setup.ts` imports `../src/i18n` so `useTranslation()` returns real English
strings, and tests assert against visible copy. If you see raw keys, your test
likely renders before i18n initializes, or bypasses the setup file — make sure
the suite uses the configured `setupFiles`.

**4. Async / state races: "element not found" then it appears.** Prefer
`findBy*` / `waitFor` over `getBy*` for anything that updates after an effect or a
promise. For Zustand stores, reset state between tests (stores live outside
React and persist across tests in the same file) and drive updates through the
store's actions, not by mutating state objects.

**5. Mocking the Tauri backend.** Frontend tests run in jsdom with no Rust
backend. Code that calls Tauri commands goes through the wrappers in
`src/utils/tauri-commands.ts`, which gate on `isTauri()` and fall back in the
browser — so most tests don't need the backend at all. When a test needs a
specific command result, mock the wrapper module (`vi.mock`), not Tauri's IPC
directly.

**6. Coverage floor fails (CI only).** `npm run test:coverage` enforces per-area
floors (privacy/licensing/firm/audit/rag) set just below measured values in
`vitest.config.ts`. If a PR drops coverage in a sensitive area below its floor,
either add tests or, if you genuinely moved code, adjust the floor with a note
explaining why. Don't silence it blindly — these areas are floored on purpose.

---

## Playwright (browser E2E)

Config: [`playwright.config.ts`](../../playwright.config.ts). Specs in
`tests/e2e/`. The suite runs against a **preview bundle** (production-like), not
the dev server, and has `en`/`es`/`de` language projects.

```bash
bash scripts/run-e2e-preview.sh                      # build preview + run chromium (the way CI does it)
npx playwright test tests/e2e/<spec>.spec.ts         # one spec (auto-starts a dev webServer)
npx playwright test tests/e2e/<spec> --retries=0     # see the REAL failure, no retry masking
npx playwright test --ui                             # interactive debugger
```

### Common failure modes

**1. A spec is flaky on CI but passes locally.** That's why there's a
**quarantine list** — the `CI_QUARANTINE` array in `playwright.config.ts`,
excluded from the CI gate when `E2E_CI_QUARANTINE=1` so the gate stays a
trustworthy green. Quarantined specs **still run locally** and nightly. If your
spec is on that list, it has an owner + fix-or-delete-by date in
[e2e-flaky-quarantine.md](./e2e-flaky-quarantine.md). To fix one: reproduce
locally with `--retries=0`, then fix the root cause — seed state
deterministically and wait on a stable `data-testid`, never a fixed timeout.
Adding a *new* spec to quarantine means adding its tracking row in the same
change.

**2. Port / server problems.** By default Playwright auto-starts a dev
`webServer`; when `E2E_BASE_URL` is set it skips that and points all projects at
your server (this is how `run-e2e-preview.sh` and CI run it, against the preview
on a fixed port). "Connection refused" usually means the preview server didn't
come up — check its log, and that nothing else holds the port.

**3. Timeouts / cold-start.** Per-test timeout is 60s (cold start can be slow);
retries are 2 on CI, 1 locally. A spec that times out at the same step every time
is a real bug or a missing wait, not flakiness — don't just bump the timeout.

**4. AI / live-network specs.** The one live-network test is skipped via
`E2E_NO_LIVE=1` in CI (AI is offline there). If a test needs a model response,
it must use a fixture/offline path — real model calls are nondeterministic and
cost tokens, so they don't belong in the gate.

**5. Visual snapshot diffs.** Visual baselines (`toHaveScreenshot`, 2% tolerance)
were captured on a pinned environment (Windows 11 25H2, a specific WebView2
version, **150% display scaling** — see
[verifier-environment.md](./verifier-environment.md)). A scaling or WebView2
change moves far more than 2% of pixels and needs a deliberate re-baseline, not a
"fix the flaky snapshot" patch.

> **Windows-specific timing.** The real desktop app is driven on a Windows bench
> over CDP, where SSH round-trips and indexing are slow and serial. That's a
> different harness from the browser E2E gate — its gotchas (async storage-flush
> races, native dialogs, clean-slate resets) live in
> [2026-06-24-how-we-test-keepance.md](./2026-06-24-how-we-test-keepance.md) and
> the bench memory notes, not here.

---

## Rust (`cargo test`)

```bash
cd src-tauri
CI=1 cargo test --workspace --locked                 # the way the gate/CI runs it
cargo test -p keepance_lib rag::                     # one module
cargo test -p keepance-vault                         # a pure crate (fast, isolated)
cargo test -- --nocapture some_test                  # see println! / dbg! output
```

### Common failure modes

**1. A RAG test is "ignored" / silently skipped — `REQUIRE_RAG_MODEL` (+ `--ignored`).**
Tests that exercise real embedding/retrieval need the **e5-small** model cached on
disk. There are two distinct skip mechanisms, and you usually need *both* env +
flag to actually run everything:

```bash
REQUIRE_RAG_MODEL=1 cargo test --workspace                # self-skipping tests: fail loud if model missing
REQUIRE_RAG_MODEL=1 cargo test --workspace -- --ignored   # ALSO run the #[ignore]'d heavy/model tests
```

- **Self-skipping tests** (e.g. the `skip_without_model!` macro in
  `src-tauri/tests/rag_matter_scope.rs`) check `model_is_provisioned()` and skip
  when the cache is absent. `REQUIRE_RAG_MODEL` set (non-empty) flips that skip
  into a **loud panic** when the model is missing — so a "passing" CI run can't
  hide a broken RAG path on a machine that's supposed to have the model. It does
  **not**, by itself, make `#[ignore]`'d tests run.
- **`#[ignore]`'d tests** (e.g. `src-tauri/tests/rag_embed_memory.rs:22`,
  `rag_deposition_contradictions.rs:849`/`:877`) are excluded by cargo until you
  pass `-- --ignored`. Combine both as above.

`REQUIRE_RAG_MODEL` is set on the nightly server (which has the model) and is the
right flag locally when you're working on `src-tauri/src/commands/rag/`,
`crm/engine.rs`, or the OneDrive import. The skip/require logic lives in the
affected tests (`src-tauri/tests/rag_*.rs`, `onedrive_fixture_import.rs`,
`crm/engine.rs`). See [RAG_PIPELINE.md](../reference/RAG_PIPELINE.md) for what the
model does.

**2. `cargo` build lock / a job self-aborts (exit 144).** Cargo serializes
concurrent compiles against one target dir. If you run two Rust builds at once
(e.g. two agents), one may block on the build lock; in the parallel-agent harness
that triggers a self-abort. **Run one Rust compile at a time.**

**3. `protoc not found` / missing webkit deps.** A dependency needs the protobuf
compiler, and the Tauri build needs webkit/appindicator/rsvg on Linux. Install
the system deps from [DEVELOPER_ONBOARDING.md](../operations/DEVELOPER_ONBOARDING.md)
§1 (the same list CI installs).

**4. Tauri build validates `externalBin` before tests compile.** `tauri`
validates `bundle.externalBin` (e.g. `binaries/piper`) before compiling tests; on
a clean checkout `binaries/` has only `.gitkeep`, so a stub must exist or
`cargo test` fails to even build. CI stages a stub; locally, if you hit this,
create an executable stub at the expected path (CI does
`printf '#!/bin/sh\nexit 0\n' > src-tauri/binaries/piper-<target>`).

**5. Keychain-dependent tests.** Integration tests that hit the real OS keychain
are gated behind an env flag (CI runners rarely have a secret-service daemon) —
see [TAURI_COMMANDS.md](../reference/TAURI_COMMANDS.md). Pure helpers are tested
directly in `#[cfg(test)]` blocks and don't need the OS.

---

## Static gates (typecheck + ESLint)

- **`npm run typecheck` fails:** `tsc --noEmit` over `src/`. Note `tsconfig`
  type-checks `src/` only — test files are validated by actually running Vitest
  (and `npm run typecheck:tests` against `tsconfig.test.json`). A "module not
  found" usually means a missing `@/` path or a missing barrel export.
- **`npm run lint:gate` fails:** this is a **regression** gate
  (`scripts/eslint-gate.mjs` vs `.eslint-baseline.json`), keyed on (file, rule,
  message). It fails only when your change **adds** a new problem. If you
  legitimately removed/moved lint issues and the baseline is now stale,
  regenerate it: `node scripts/eslint-gate.mjs --update-baseline`. Don't "fix"
  pre-existing baseline issues just to make it pass — that's out of scope for the
  gate.
- **i18n parity is report-only** (`KNOWN-I18N-01`). It never fails the gate.
  **Never** run `npm run i18n:extract` to "fix" drift — it rewrites locale files
  and wipes existing es/de translations.

---

## A quick triage flow

1. **Reproduce the one red suite in isolation** (the four commands at the top).
2. **Read the actual error**, not the summary. For Playwright, re-run with
   `--retries=0` so retries don't mask the real failure.
3. **Is it environment or logic?** jsdom polyfill gaps, the
   confidentiality-mode seed, `REQUIRE_RAG_MODEL`, the build lock, missing
   system deps, the quarantine list — these are environment, and the fixes are
   above. If none fit, it's a real logic bug: write the smallest failing test
   that proves it, then fix (red → green).
4. **Verify before claiming done.** Re-run the exact command and paste its
   pass/fail output — evidence before assertions. Then run `npm run gate` for the
   full pre-merge check.

## See also

- [README.md](./README.md) — the whole test pyramid and where each layer runs.
- [DEVELOPER_ONBOARDING.md](../operations/DEVELOPER_ONBOARDING.md) — how the gate
  + CI are wired.
- [e2e-flaky-quarantine.md](./e2e-flaky-quarantine.md) / [verifier-environment.md](./verifier-environment.md) — the E2E quarantine list and the pinned visual baseline.
- [RAG_PIPELINE.md](../reference/RAG_PIPELINE.md) — what `REQUIRE_RAG_MODEL` tests exercise.
