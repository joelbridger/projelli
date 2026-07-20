# Developer onboarding

> A step-by-step runbook to go from a fresh clone to a running app, a green test
> gate, and a merged change. Written for a developer (human or AI) new to the
> repo. Commands here were pulled from `package.json`,
> `src-tauri/tauri.conf.json`, `scripts/gate.sh`, and `.github/workflows/` on
> 2026-06-28 — if one drifts, trust those files. Read
> [`ARCHITECTURE.md`](../../ARCHITECTURE.md) and
> [`CLAUDE.md`](../../CLAUDE.md) alongside this.

Advisor Prep Hero is a **Tauri 2 desktop app**: a Rust backend (`src-tauri/`) and a React
18 + TypeScript 5 + Vite 6 frontend (`src/`), plus a small Node/Bun firm backend
(`backend/`). You can run the UI in a plain browser for fast iteration, or as the
real desktop app.

---

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| **Node.js** | 20.x | CI uses Node 20. Some test polyfills assume it (Node 22-only APIs are shimmed). |
| **npm** | bundled with Node | The repo uses npm + a committed `package-lock.json`. |
| **Rust** | current **stable** (≥ 1.78) | Edition 2021. `lancedb 0.21` needs ≥ 1.78 even though the crate pins 1.77.2. Install via [rustup](https://rustup.rs). |
| **Tauri 2 system deps** | per-OS | See [tauri.app prerequisites](https://tauri.app/start/prerequisites/). |
| **protoc** | any recent | Protobuf compiler — needed by a Rust dependency. |
| **Bun** | latest | Only for the `backend/` firm server. |

**Linux system deps** (the exact set CI installs — `.github/workflows/ci.yml`):

```bash
sudo apt-get install -y protobuf-compiler libwebkit2gtk-4.1-dev \
  libappindicator3-dev librsvg2-dev patchelf libssl-dev libfuse2
```

**Windows:** install the Microsoft C++ Build Tools and the WebView2 runtime
(ships with Windows 11). **macOS:** install the Xcode Command Line Tools
(`xcode-select --install`). Both also need `protoc` (e.g. `brew install
protobuf` / `choco install protoc`).

---

## 2. Clone + install

```bash
git clone https://github.com/keepance/keepance.git
cd keepance
git checkout keepance-3.0          # the active development branch (NOT master)
npm install                        # installs deps AND runs `prepare` → git hooks
```

`npm install` runs `scripts/install-git-hooks.sh`, which sets
`core.hooksPath=.githooks`. That installs the **pre-push hook** (fast gate:
typecheck + unit tests). The Rust crates compile on the first `cargo`/`tauri`
command — the first build is slow (cold compile of LanceDB + fastembed); later
builds are incremental.

> **Branch note:** day-to-day work happens on `keepance-3.0`. `master` exists but
> the product line is on `keepance-3.0`. Branch your feature work off
> `keepance-3.0`.

---

## 3. Run it

```bash
npm run dev          # Vite dev server in a browser at http://localhost:5173 — fastest UI loop
npm run tauri:dev    # the real desktop app (Rust backend + WebView). Slower first start.
```

- **`npm run dev`** is the fast loop for UI work. It runs in a normal browser, so
  anything needing the Rust backend (real filesystem, keychain, RAG indexing,
  local AI) is stubbed or unavailable — but most component/UX work doesn't need
  it.
- **`npm run tauri:dev`** launches the actual app. `tauri.conf.json` wires it to
  the Vite server (`devUrl: http://localhost:5173`, `beforeDevCommand: npm run
  dev`), so it starts Vite for you. Use this whenever you touch Rust, the
  keychain, the vault, connectors, or RAG.

Production build (creates installers under `src-tauri/target/release/bundle/`):

```bash
npm run build        # frontend bundle only (tsc -b && vite build)
npm run tauri:build  # full signed-installer build — slow (~minutes), rarely needed locally
```

> A full installer build is **not** the iteration loop. For verifying behavior in
> the real app, the team drives a built "preview" bundle on a real Windows bench
> — see [how-we-test-keepance.md](../quality/2026-06-24-how-we-test-keepance.md).

---

## 4. Run the tests

```bash
npm test                 # Vitest: ~3,000+ unit/integration tests (jsdom)
npm run test:watch       # watch mode while developing
npm run test:coverage    # with coverage (CI enforces per-area floors)
npm run typecheck        # tsc --noEmit (src/ only)

# Rust:
cd src-tauri && CI=1 cargo test --workspace --locked

# Browser E2E (Playwright):
bash scripts/run-e2e-preview.sh     # build the preview bundle + run the chromium suite

# Firm backend:
cd backend && bun install && bun test
```

A few things worth knowing up front (full detail in
[TROUBLESHOOTING_TESTS.md](../quality/TROUBLESHOOTING_TESTS.md)):

- `tsconfig` type-checks **`src/` only**, so `npx vitest run` is the real safety
  net for the correctness of test files themselves.
- Some Rust RAG tests self-skip unless the e5-small embedding model is cached.
  `REQUIRE_RAG_MODEL=1` turns that skip into a loud failure; heavier tests marked
  `#[ignore]` additionally need `cargo test -- --ignored`.
- The Playwright suite has a CI-quarantine list of flaky specs (see
  [e2e-flaky-quarantine.md](../quality/e2e-flaky-quarantine.md)); they still run
  locally.

---

## 5. Make a change

The codebase is **feature-first** with a 5-layer dependency DAG — read
[`ARCHITECTURE.md`](../../ARCHITECTURE.md) before adding code so you put it in the
right layer (`lib` ← `ui` ← `platform` ← `features` ← `app`). The short version:

- A **product surface** is a folder under `src/features/<surface>/`. To
  understand a surface, read its one folder.
- A capability used by **two or more** features belongs in `src/platform/`, not
  copied or cross-imported between features. The layer rules are
  machine-enforced by `tests/unit/architecture-boundaries.test.ts`.
- Imports use the `@/` alias (`@/features/ask/Ask`,
  `@/platform/rag/MemoryService`).
- Adding a **Rust command**? Follow the checklist in
  [TAURI_COMMANDS.md](../reference/TAURI_COMMANDS.md) (write the command, register
  it in `lib.rs`, add a frontend wrapper, test the pure helper, document it).
- For the native side generally, see
  [RUST_BACKEND.md](../reference/RUST_BACKEND.md);
  [RAG_PIPELINE.md](../reference/RAG_PIPELINE.md);
  [CONNECTORS.md](../reference/CONNECTORS.md).

**Core-app rule (set by the product owner):** for the product itself (the desktop
app and its Rust backend), do **not** ship quick or partial fixes — take the
robust route. Prefer test-driven development: one behavior test → implement →
repeat. The repo ships `tdd` and `diagnosing-bugs` skills for exactly this.

After any change, add a `CHANGELOG.md` entry under `## [Unreleased]`.

---

## 6. The gate (run before you push)

One command checks everything CI will check:

```bash
npm run gate            # asset copy + Tauri version parity + typecheck + brand/identity checks
                         #   + i18n(report-only) + Vitest + ESLint gate + Rust cargo tests
npm run gate:full       # also runs the browser E2E suite + the headless desktop harness (slow)
npm run gate:ci-parity  # runs what CI checks that `gate` doesn't (see below) — pre-flight before a release
```

`scripts/gate.sh` runs, in order: `node scripts/copy-build-assets.mjs` →
`node scripts/check-tauri-parity.mjs` (npm/Cargo/Tauri version drift — the
check whose absence let v3.3.5-rc.2 ship a version-mismatched build) →
`npm run typecheck` → `npm run brand:check` →
`npm run identity:check` → `npm run i18n:check` (report-only, won't fail the
gate) → `npx vitest run` → `npm run lint:gate` → `cargo test --workspace
--locked`. Green ends with `✅ GATE GREEN`.

**`npm run gate` and CI are not 100% identical** — CI additionally runs the
frontend coverage floor, the backend (`bun`) typecheck + tests, and the
`cargo-deny` supply-chain gate (see the CI table below), none of which
`gate.sh` runs locally (coverage/backend/cargo-deny are either slow or need
toolchains `gate.sh` doesn't assume). `npm run gate:ci-parity`
(`scripts/gate-ci-parity.sh`) runs exactly that gap — coverage floor, backend
tests, cargo-deny — so a release operator can catch a CI-only failure before
pushing/tagging instead of after. It degrades gracefully: if `bun` or
`cargo-deny` isn't installed locally, that check is reported as `SKIPPED`
rather than failing. Run both before anything release-shaped:
`npm run gate && npm run gate:ci-parity`.

⚠️ **That `SKIPPED` is not free.** `cargo deny check advisories` was RED and
UNREAD for ~3 months on RUSTSEC-2026-0002 (`lru 0.12.5`), because `gate.sh`
never runs cargo-deny at all and `gate-ci-parity.sh` skipped it on any box
without the binary installed — a skipped check still prints a green summary.
If you are making a release decision, confirm cargo-deny actually RAN; a
`⚠️ SKIPPED` line is an unknown, not a pass.

`gate-ci-parity.sh` also runs **`scripts/check-deny-revisit.sh`**, which is
deliberately NOT skippable (pure bash + python3). Every entry in
`[advisories].ignore` of `src-tauri/deny.toml` must carry a `reason`, an
`OWNER: <name>` and a `REVISIT: YYYY-MM-DD` date, and the gate fails once a
revisit date has passed. cargo-deny 0.19's ignore entry accepts only the keys
`["id", "reason"]` — there is no `expires` field — so the owner and the expiry
live inside the reason string (cargo-deny prints it under
`note[advisory-ignored]` at `-L info`) and are enforced by that script.
`bash scripts/check-deny-revisit.sh --self-test` proves the checker can go red
(10 fixtures: 4 red rules, 4 fail-closed parse cases, 2 green).

Two gotchas:

- **ESLint is a *regression* gate, not a clean-tree gate.** `npm run lint:gate`
  (`scripts/eslint-gate.mjs`) compares against a committed fingerprint baseline
  (`.eslint-baseline.json`) keyed on (file, rule, message). It fails only if your
  change **adds new** problems — it does not require fixing pre-existing ones. If
  you legitimately remove/relocate lint issues, regenerate the baseline with
  `node scripts/eslint-gate.mjs --update-baseline`.
- **i18n is report-only** (`KNOWN-I18N-01` deferred). Never "fix" the drift with
  `i18n:extract` — that rewrites locale files and wipes existing es/de
  translations.

The **pre-push hook** runs a fast subset (typecheck + Vitest) automatically.
Bypass it only for docs-only pushes with `git push --no-verify`.

---

## 7. PR workflow + CI

Push your branch and open a PR against `keepance-3.0`. CI
(`.github/workflows/ci.yml`) runs on every PR and every push to `master` /
`keepance-3.0`, in three jobs:

| Job | What runs |
|---|---|
| **quality** | Tauri version parity, brand sync check, identity check, `tsc --noEmit`, i18n parity (report-only), the ESLint regression gate, and Vitest **with the coverage floor**. |
| **backend** | `bun typecheck` + `bun test` in `backend/`. |
| **rust** | `cargo test --workspace --locked` (with `protoc` + webkit deps + a Piper sidecar stub). |
| **cargo-deny** | License + supply-chain gate (`cargo deny check advisories licenses sources bans` in `src-tauri/`). |
| **e2e** | Builds the E2E preview bundle and runs the Playwright chromium suite offline (`E2E_NO_LIVE=1`), with the flaky specs quarantined (`E2E_CI_QUARANTINE=1`). |

`release.yml`'s `gate` job (run before any signed build starts) mirrors the
same fast static checks — Tauri version parity, brand sync, identity check,
typecheck, i18n (report-only), coverage floor, ESLint gate, Rust tests — so a
release tag can't ship a build CI would have rejected.

Nightly timers run the full gate + the real-bench cargo tests, guarded by a
watchdog that pings if a night is missed. A release tag (`v*`) triggers
`release.yml`, the signed Win/Mac/Linux installer matrix.

**Releases / real-OS verification are not part of the normal change loop.** Signed
builds and driving the app on real Windows/Mac are owned by the testing process
([docs/quality/](../quality/README.md)); a routine code change just needs the
gate green and CI passing.

---

## Quick reference

| Goal | Command |
|---|---|
| Browser dev loop | `npm run dev` (→ `localhost:5173`) |
| Real desktop app | `npm run tauri:dev` |
| Unit tests | `npm test` / `npm run test:watch` |
| Types | `npm run typecheck` |
| Rust tests | `cd src-tauri && cargo test --workspace --locked` |
| RAG-model Rust tests | `REQUIRE_RAG_MODEL=1 cargo test ...` (add `-- --ignored` for `#[ignore]`d heavy tests) |
| Browser E2E | `bash scripts/run-e2e-preview.sh` |
| Full pre-push check | `npm run gate` |
| CI-only checks pre-flight (before a release) | `npm run gate:ci-parity` |
| Production build | `npm run tauri:build` |
| Format | `npm run format` |

## See also

- [`ARCHITECTURE.md`](../../ARCHITECTURE.md) — the 5-layer map of `src/` (read first).
- [TAURI_COMMANDS.md](../reference/TAURI_COMMANDS.md) — adding a Rust command.
- [RUST_BACKEND.md](../reference/RUST_BACKEND.md) / [RAG_PIPELINE.md](../reference/RAG_PIPELINE.md) / [CONNECTORS.md](../reference/CONNECTORS.md) — the native subsystems.
- [TROUBLESHOOTING_TESTS.md](../quality/TROUBLESHOOTING_TESTS.md) — when a test fails.
- [docs/quality/README.md](../quality/README.md) — the full testing picture.
