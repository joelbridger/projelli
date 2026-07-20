# BENCH TODO — drop `script-src 'unsafe-inline'` from the PRODUCTION CSP

**Status:** STAGED, NOT ACTIVATED. This lane (Amplifier Phase-B, c34) set up the
dev/prod CSP split so the production drop is a single verified toggle. The drop
itself is DEFERRED to a packaged bench because the effective shipped CSP must be
read off the real binary first (HD-3).

`tauri.conf.json` is strict JSON (`additionalProperties: false`), so this note
lives beside it rather than as an inline comment.

## What is already done (this lane — invisible, reversible)

- Added `app.security.devCsp`, identical to `app.security.csp`. It RETAINS
  `script-src 'unsafe-inline'` for the Vite dev server (HMR / react-refresh
  inject inline scripts). Production behavior is unchanged: a packaged build
  ignores `devCsp` and uses `csp`, which is byte-for-byte what it was before.
- Migrated all 8 renderer `window.__TAURI__` feature-detects to the durable
  `__TAURI_INTERNALS__ || __TAURI__` pattern, so the sibling `withGlobalTauri`
  flip is also safe. (That flip is a SEPARATE bench TODO — see below.)

## THE ONE CHANGE the bench makes (the toggle)

In `src-tauri/tauri.conf.json`, replace the `app.security.csp` value's
`script-src` token list ONLY — remove `'unsafe-inline'`:

- FROM: `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`
- TO:   `script-src 'self' 'wasm-unsafe-eval'`

Leave `devCsp` exactly as-is (dev keeps `'unsafe-inline'`). Do NOT touch
`style-src 'unsafe-inline'` (≈2,900 inline-style sites — load-bearing, separate
deferred project) or `wasm-unsafe-eval` (tesseract OCR + pdfjs — load-bearing).

The full production `csp` value AFTER the drop (paste-ready):

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com https://forms.lanternplatform.app https://licenses.lanternplatform.app https://api.lanternplatform.app wss://api.lanternplatform.app http://127.0.0.1:11434 http://127.0.0.1:18089
```

## Bench proof required BEFORE and AFTER the toggle (HD-3)

1. **Dump the EFFECTIVE shipped CSP off the packaged binary first.** With
   `dangerousDisableAssetCspModification: false` (default), Tauri parses the
   built `dist/` at compile time and injects script hashes/nonces into
   `script-src`. Per the CSP spec, once a hash/nonce is present the browser
   IGNORES `'unsafe-inline'` — so the token may already be inert in the packaged
   build. Confirm the effective `script-src` from the real binary, not source.
2. **After the drop:** launch the packaged app, exercise every feature, and
   confirm ZERO `script-src` CSP violations in the devtools console.
3. **Blocked-payload proof:** confirm a synthetic markdown/`.docx` `onerror`
   inline-handler payload (the render-sink class) does NOT execute.

## Sibling bench TODO (tracked separately, same design)

`app.withGlobalTauri: true → false` is the OTHER half of the amplifier removal.
Its 8-site renderer re-plumb is DONE in this lane (durable detection). The flip
is deferred to the same packaged bench; prove FS backend, OS keychain, and
native HTTP all still engage with `window.__TAURI__ === undefined`. See
`src/platform/fs/nativeBackendResolution.demotion.test.ts` and
`src/platform/providers/nativeBackendResolution.demotion.test.ts` for the
dev-level no-demotion proofs (necessary but not sufficient — the binary settles it).
