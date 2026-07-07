# L2 desktop tests — driving the REAL Lantern app headless

These tests drive the **real Tauri (Rust) Lantern app** — actual keychain, encrypted mail
store, RAG, .docx engine, multi-window, real file persistence — headless on Linux, via
`tauri-driver` + `WebKitWebDriver` + `xvfb`. They catch the class of bug that used to surface
only after a slow signed build (firm login, mail import showing up, vault, co-editing).

This is **Layer 2** of the [test plan](../../docs/quality/2026-06-18-user-test/TEST-PLAN.md).
The full user-story catalog is in [USER-STORIES.md](../../docs/quality/2026-06-18-user-test/USER-STORIES.md).

## Run

```bash
npm run test:desktop            # every spec in specs/ (sorted)
npm run test:desktop 00 mail    # only specs whose filename contains "00" or "mail"
# or directly: tests/desktop/run.sh [patterns...]
```

Each spec gets a **fresh isolated profile** (temp `HOME`/`XDG_*`/workspace under `/tmp`), its own
`tauri-driver`, and a shared Vite frontend on `:5173` (reused if already running, else started).
Pass screenshots and per-spec logs land in `evidence/` (gitignored). A failing spec writes
`<name>.FAIL.png`.

## Prerequisites (all already on this server)

- `src-tauri/target/debug/keepance` — the debug app binary (rebuild after Rust changes:
  `npm run tauri build -- --debug`, or `cargo build` in `src-tauri/`). It expects the Vite dev
  server because it's a dev-mode build (`devUrl`).
- `tauri-driver` (`cargo install tauri-driver --locked`), `/usr/bin/WebKitWebDriver`, `xvfb-run`, `node`.

## Writing a spec

A spec is an ES module in `specs/` that default-exports `{ name, async run(ctx) }`. It **throws to
fail** and returns normally to pass. `ctx`:

| field | what |
|---|---|
| `session` | the WebDriver `Session` (see `harness/webdriver.mjs`) — `testid()`, `clickTestid()`, `typeTestid()`, `execute()`, `waitForBodyText()`, `screenshot()`, … |
| `workspace` | absolute path to this run's temp workspace dir (real Tauri FS) — write fixture files here |
| `tmproot` | the temp profile root (`home`, `xdg-*` live under it) |
| `evidenceDir` | where to drop extra screenshots |
| `app` | high-level helpers (`harness/app.mjs`): `bootToWorkspace()`, `seedReadyState()`, `gotoSurface()`, `xpathLiteral()` |
| `log` | `(msg) => void` |

### Pattern (copy this)

```js
// specs/NN-my-journey.mjs
import fs from 'node:fs';
import path from 'node:path';

export default {
  name: 'NN-my-journey',
  async run({ session, workspace, app }) {
    // 1) seed any fixture files into the real workspace on disk
    fs.writeFileSync(path.join(workspace, 'contract.md'), '# Test\n');

    // 2) boot the real app to that workspace (skips onboarding + tour)
    await app.bootToWorkspace(session, { workspacePath: workspace });

    // 3) drive the real UI by data-testid and assert observable results
    await app.gotoSurface(session, 'Documents');
    await session.waitForBodyText('contract.md');
    await session.clickTestid('some-button');
    if (!(await session.hasTestid('expected-result'))) {
      throw new Error('expected-result did not appear');
    }
  },
};
```

### Conventions

- **Find elements by `data-testid`** (`session.testid('x')` / `clickTestid` / `typeTestid`). The
  catalog in `inventory/` lists the real testids per story. Fall back to XPath by visible text via
  `session.find('xpath', ...)` + `app.xpathLiteral(text)` when no testid exists.
- **Assert observable state**, not internals: a visible element, body text, or a real file on disk
  (read it back from `workspace`).
- **Onboarding / firm-create specs**: do NOT call `bootToWorkspace` (it bypasses onboarding).
  Call `session.newSession()` yourself and drive the real first-run flow.
- **Two-instance specs** (firm co-editing, ethical walls): create two `Session`s. Note the current
  `run.sh` starts one `tauri-driver` per spec; a two-instance spec needs two driver ports — see the
  firm spec for the helper, or run the second instance against a second `tauri-driver` the spec
  starts itself. (Tracked as a harness enhancement.)
- **Number specs** so they run in a sensible order (`00-` smoke first).
- **Keep specs honest**: if a journey needs a live backend (firm relay, real OAuth) that isn't
  wired locally yet, mark it and `throw new Error('BLOCKED: needs <x>')` rather than faking a pass.

## Files

```
tests/desktop/
  run.sh                 # orchestrator: shared Vite + per-spec isolated profile + tauri-driver
  harness/
    webdriver.mjs        # zero-dep W3C WebDriver client (Session)
    app.mjs              # Lantern helpers: bootToWorkspace, gotoSurface, seeding
    runner.mjs           # runs one spec in a session; screenshots on failure
  specs/                 # the tests (one per user journey)
    00-workspace-shell.smoke.mjs
  evidence/              # screenshots + logs (gitignored)
```
