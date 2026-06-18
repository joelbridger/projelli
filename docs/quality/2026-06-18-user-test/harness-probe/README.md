# Real Keepance Desktop Headless Harness Probe

This directory proves that the Linux debug build can be driven as the real Tauri desktop app without a signed installer.

## Working command

From the repo root:

```bash
docs/quality/2026-06-18-user-test/harness-probe/run-real-app.sh
```

Prerequisite installed during the probe:

```bash
cargo install tauri-driver --locked
```

The harness uses:

- `src-tauri/target/debug/keepance`
- `/usr/bin/WebKitWebDriver`
- `tauri-driver` v2.0.6
- `xvfb-run -a --server-args='-screen 0 1366x900x24'`
- `WEBKIT_DISABLE_COMPOSITING_MODE=1`
- `WEBKIT_DISABLE_DMABUF_RENDERER=1`
- `GDK_BACKEND=x11`

## What it proves

The driver creates a W3C WebDriver session through `tauri-driver`, launches the real debug binary, verifies `window.__TAURI__ === true`, seeds a temp recent workspace, clicks that workspace through the real UI, and asserts:

- primary navigation is visible (`data-testid="spine-nav"`)
- the Documents shell is visible (`data-testid="documents-toolbar"` and `data-testid="documents-tab-strip"`)
- the status bar is visible (`data-testid="status-bar"`)
- a real file from the temp filesystem workspace, `probe.md`, is visible in the app

That path exercises the Tauri desktop webview and Tauri filesystem backend. It avoids the native folder picker by pre-seeding Keepance's own recent-workspace localStorage, then opening that workspace normally through the app.

## Data isolation

Every run creates a fresh temp root under `/tmp/keepance-real-app.*` and launches the app with:

```bash
HOME=<tmp>/home
XDG_DATA_HOME=<tmp>/xdg-data
XDG_CONFIG_HOME=<tmp>/xdg-config
XDG_CACHE_HOME=<tmp>/xdg-cache
```

The probe workspace is `<tmp>/workspace`. This keeps WebKit profile data, Keepance app data, keychain fallback files, and `~/.keepance`-style state away from Jameson's real home directory. The only repo writes are evidence files in this directory.

## Evidence

The latest successful run writes:

- `evidence/probe.log` - full console output with the passing assertion
- `evidence/workspace-shell.png` - screenshot from the Tauri WebDriver session
- `evidence/tauri-driver.log` - native WebKitWebDriver/Tauri driver stderr
- `evidence/vite.log` - only present when the harness starts its own Vite server

## Gotchas

The debug binary is configured with `devUrl: http://localhost:5173`, so a Keepance Vite server must be available on port `5173`. The harness starts one if the port is free. If the port is already in use, it reuses it only if the page title is Keepance.

Linux WebKitGTK prints DRI3 and a11y-bus warnings under Xvfb. They are noisy but non-fatal for this harness.
