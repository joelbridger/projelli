# Tauri commands reference

> Canonical list of every Rust-backed Tauri command Projelli exposes to the
> frontend. Phase 2 of the v1.5 release added the Rust/Tauri foundation
> (`http`, `keychain`, `rag`, `watcher`) on top of the pre-existing
> filesystem helpers.

---

## Adding a new command — checklist

1. Add a new function under `src-tauri/src/commands/<area>.rs` with
   `#[tauri::command]` and `async fn` (keep async unless the command is
   truly trivial — matches the Phase 2 pattern).
2. Return `Result<T, E>` where `E` serialises to something the frontend can
   branch on (`String` for opaque, a `#[serde(tag = "kind")]` enum for
   structured cases — see `KeychainError`).
3. Register the command in the `tauri::generate_handler!` macro in
   `src-tauri/src/lib.rs`. Keep groups of related commands together.
4. If the command touches resources that need extra allowances, update
   `src-tauri/capabilities/default.json` (`fs:scope`, `http:default`, etc).
5. Add a thin wrapper in `src/utils/tauri-commands.ts`. Gate it on
   `isTauri()` and pick a reasonable browser fallback (empty value, no-op,
   or thrown error — pick one and document it).
6. Add unit tests for any pure helper the command delegates to. Rust tests
   live in a `#[cfg(test)] mod tests {}` block in the same file.
7. Document the command in this file (signature + purpose + error
   conditions + frontend example).
8. Add a `CHANGELOG.md` entry under `## [Unreleased]` -> `### Added`.

---

## Filesystem (`src-tauri/src/commands/fs.rs`)

### `check_path`

```rust
fn check_path(path: &str) -> Result<PathExistsResult, String>
```

Reports whether a path exists and whether it's a file or directory.
`PathExistsResult { exists, is_file, is_directory }`.

**Error conditions:** the path is valid UTF-8 (enforced by Tauri's IPC).
This function does not error on missing paths — missing returns `exists:
false`.

**Frontend:**
```ts
import { invoke } from '@tauri-apps/api/core';
await invoke('check_path', { path: '/Users/x/notes.md' });
```

### `get_home_dir`

```rust
fn get_home_dir() -> Result<String, String>
```

Returns the current user's home directory. Errors only if the OS refuses
to provide it (very rare).

### `open_in_explorer`

```rust
fn open_in_explorer(path: &str) -> Result<(), String>
```

Opens a folder (or the parent folder of a file) in Finder / Explorer /
`xdg-open`. Errors if the path doesn't exist or the system handler can't
be spawned.

### `detect_libreoffice`

```rust
fn detect_libreoffice() -> Result<Option<String>, String>
```

Searches standard install paths for the `soffice` binary. Returns
`Ok(Some(path))` if found, `Ok(None)` if not. Never errors in practice.

Frontend wrapper: `detectLibreOffice()` in `tauri-commands.ts`.

### `convert_doc_to_docx`

```rust
fn convert_doc_to_docx(input_path: String) -> Result<String, String>
```

Runs `soffice --headless --convert-to docx --outdir <parent> <input>`.
Returns the absolute path to the produced `.docx`. Errors when LibreOffice
isn't installed, the input is not a `.doc` file, or conversion fails.

Frontend wrapper: `convertDocToDocx(inputPath)`.

### `convert_ppt_to_pdf`

```rust
fn convert_ppt_to_pdf(input_path: String) -> Result<String, String>
```

Same headless-conversion idea for PowerPoint, but writes into a cache
keyed by `djb2(canonical_path) + mtime` under `std::env::temp_dir()`.
Errors: LibreOffice missing, input not a `.ppt/.pptx`, conversion failed,
or move-into-cache failed.

Frontend wrapper: `convertPptToPdf(inputPath)`.

---

## HTTP (`src-tauri/src/commands/http.rs`) — Phase 2 (v1.5)

### `fetch_url_title`

```rust
async fn fetch_url_title(url: String) -> Result<String, String>
```

Fetches the HTML `<title>` of a URL for Q12 smart paste. Returns `""` on
any error so the frontend falls back to inserting the raw URL. Safe:
5-second timeout, 10 MiB body cap, up to 5 redirects, custom user agent.

**Error conditions:** the command returns `Ok("")` rather than `Err(_)` in
every failure mode so the UI contract stays simple. A thrown JS error only
happens if Tauri's IPC itself fails.

**Frontend:**
```ts
import { fetchUrlTitle } from '@/utils/tauri-commands';
const title = await fetchUrlTitle('https://example.com');
const mdLink = title ? `[${title}](${url})` : url;
```

### `ollama_list_models` (Phase 4 stub)

```rust
async fn ollama_list_models() -> Result<Vec<String>, String>
```

Phase 2 stub — always returns `Err("not implemented yet")`. Phase 4 wires
this to `http://127.0.0.1:11434/api/tags`.

### `ollama_chat_stream` (Phase 4 stub)

```rust
async fn ollama_chat_stream(model: String, messages: JsonValue) -> Result<(), String>
```

Phase 2 stub. Phase 4 will emit a Tauri event stream of text chunks.

---

## Keychain (`src-tauri/src/commands/keychain.rs`) — Phase 2 (v1.5)

All three commands share a structured `KeychainError` type. The frontend
binding exports the matching TypeScript interface.

```ts
type KeychainErrorKind = 'notFound' | 'noBackend' | 'denied' | 'other';
interface KeychainError { kind: KeychainErrorKind; message: string }
```

Default service namespace: `"com.projelli.app"`. Pass `service` to scope a
secret to a sub-feature.

### `keychain_set`

```rust
async fn keychain_set(service: Option<String>, key: String, value: String) -> Result<(), KeychainError>
```

Stores (or overwrites) `value` under `(service, key)`. Errors:
`noBackend` on Linux without a secret-service daemon, `denied` when the
user denies a Keychain prompt on macOS, `other` for anything else.

### `keychain_get`

```rust
async fn keychain_get(service: Option<String>, key: String) -> Result<String, KeychainError>
```

Reads the stored secret. Returns `KeychainError { kind: 'notFound' }` if
no entry exists.

### `keychain_delete`

```rust
async fn keychain_delete(service: Option<String>, key: String) -> Result<(), KeychainError>
```

Idempotent delete — succeeds silently if the entry wasn't there.

**Frontend:**
```ts
import { keychainSet, keychainGet, keychainDelete } from '@/utils/tauri-commands';
await keychainSet('anthropic-api-key', 'sk-ant-...');
const key = await keychainGet('anthropic-api-key');
await keychainDelete('anthropic-api-key');
```

---

## RAG (`src-tauri/src/commands/rag.rs`) — Phase 2 stubs

All three commands return `Err("RAG is not implemented in Phase 2 — scaffolding lands in Phase 3 (M1).")` for now. The `Hit`
shape is frozen so frontend UI can be built today.

```ts
interface RagHit {
  path: string;
  chunkText: string;
  score: number;        // cosine similarity, [0.0, 1.0]
  paragraphIndex: number;
}
```

### `rag_index_file`

```rust
async fn rag_index_file(path: String) -> Result<(), String>
```

### `rag_index_workspace`

```rust
async fn rag_index_workspace() -> Result<(), String>
```

### `rag_retrieve`

```rust
async fn rag_retrieve(query: String, top_k: u32) -> Result<Vec<Hit>, String>
```

Frontend wrappers: `ragIndexFile`, `ragIndexWorkspace`, `ragRetrieve`.

---

## Watcher (`src-tauri/src/commands/watcher.rs`) — Phase 2 (v1.5)

### `watch_workspace`

```rust
async fn watch_workspace(app: AppHandle, path: String) -> Result<(), String>
```

Starts (or replaces) a recursive `notify` watcher on `path`. Emits the
Tauri event `workspace-file-changed` with payload
`{ path: string; kind: 'create' | 'modify' | 'delete' | 'rename' }`.

Only one watcher is active at a time. A 200 ms debounce per-path prevents
event spam (saving a file usually emits create+modify together).

**Error conditions:**
- `Err(...)` if the target path doesn't exist, the OS refuses to set up
  the watcher, or the internal singleton mutex is poisoned.

**Frontend:**
```ts
import { listen } from '@tauri-apps/api/event';
import { watchWorkspace, type WorkspaceChangeEvent } from '@/utils/tauri-commands';

await watchWorkspace('/Users/x/my-workspace');
const unlisten = await listen<WorkspaceChangeEvent>(
  'workspace-file-changed',
  (ev) => {
    console.log(ev.payload.path, ev.payload.kind);
  },
);
```

---

## Testing Tauri commands

Pure helpers are tested directly with `#[cfg(test)]` blocks in the same
file. Examples:

- `http::extract_title_from_html` — regex + entity decode over fixture
  strings. No network required.
- `keychain::map_keyring_error` — table-driven mapping from `keyring::Error`
  variants to our `KeychainError`.
- `watcher::Debouncer` — time-injected (takes `Instant` as a parameter)
  so tests don't sleep.

Integration tests against the real OS keychain are gated behind
`PROJELLI_TEST_KEYCHAIN=1` because CI runners rarely have a secret service
daemon running.

Run everything with:
```bash
cd src-tauri
cargo test -p projelli
cargo clippy --all-targets -- -D warnings
```
