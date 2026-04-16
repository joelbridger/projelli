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

### `ollama_list_models` (legacy stub, kept for compatibility)

```rust
async fn ollama_list_models() -> Result<Vec<String>, String>
```

Phase 2 stub. Q7 (Phase 4) moved Ollama integration entirely to the
frontend — the `OllamaProvider` in `src/modules/models/OllamaProvider.ts`
talks to `http://127.0.0.1:11434` directly (the CSP allows it), so this
Rust command is no longer called. It stays in the handler list for
backward compatibility and will be removed in the v1.6 release.

### `ollama_chat_stream` (legacy stub)

```rust
async fn ollama_chat_stream(model: String, messages: JsonValue) -> Result<(), String>
```

Legacy stub — see `ollama_list_models` above. Streaming is handled in the
browser using `ReadableStream` + NDJSON parsing (`parseNdjsonChunk` in
`OllamaProvider.ts`).

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

## MCP (`src-tauri/src/commands/mcp.rs`) — Phase 4 M4 (v1.5 Flag 2)

Host-side bridge between the `projelli-mcp` sidecar binary and the desktop
app. The sidecar is cross-process — whichever MCP client (Claude Desktop,
Cursor, Zed) spawned it owns its stdio — so the approval channel is a
filesystem rendezvous under `<temp>/projelli-mcp/{requests,responses}/`.

### `mcp_list_pending_approvals`

```rust
async fn mcp_list_pending_approvals() -> Result<Vec<PendingApproval>, String>
```

Read the `requests/` directory and return every pending write as
`PendingApproval { token, path, preview, fileExists, oldPreview,
contentBytes, receivedAt }` (camelCase on the wire). Malformed files are
skipped silently so a single bad entry doesn't block the rest. Returns
`[]` when the directory is missing. Safe to call on a 1-second poll.

### `mcp_approve_write`

```rust
async fn mcp_approve_write(token: String, approved: bool) -> Result<(), String>
```

Write the user's decision to `responses/<token>.json`. The sidecar's
`wait_for_response` polls the same directory and picks it up within
100 ms, deletes both the request and response files, and returns its
JSON-RPC reply to the MCP client.

**Error conditions:**
- `Err("token is empty")` for empty input.
- `Err("token must be hex")` when the token contains non-hex characters.
  Prevents a frontend bug from passing `..` and escaping the responses dir.

**Frontend:**
```ts
import { mcpListPendingApprovals, mcpApproveWrite } from '@/utils/tauri-commands';

const pending = await mcpListPendingApprovals();
if (pending.length) {
  // ... show modal, wait for user decision ...
  await mcpApproveWrite(pending[0].token, true);
}
```

### `mcp_bundle_path`

```rust
async fn mcp_bundle_path(app: AppHandle) -> Result<Option<String>, String>
```

Resolve the absolute path of the platform `.mcpb` bundle. Lookup order:
1. Tauri resource dir: `<resource>/mcpb/projelli-<target>.mcpb` (production)
2. Dev-build fallback: `<cwd>/dist/projelli-<target>.mcpb` and one/two
   levels up, so engineers running `npm run tauri:dev` after
   `node scripts/build-mcpb.mjs` get a hit.

Returns `Ok(None)` when neither path exists — the Settings UI renders a
"Bundle not available" hint instead of throwing.

---

## Voice (`src-tauri/src/commands/voice.rs`) — Phase 4 M6 (v1.5 Flag 4)

Press-to-talk voice input. The renderer captures microphone audio via
`navigator.mediaDevices.getUserMedia` + `MediaRecorder`, re-encodes to
16 kHz mono 16-bit PCM WAV via a small Web Audio pipeline in
`src/modules/voice/VoiceCapture.ts`, and ships the bytes into the bundled
Parakeet.cpp (or whisper.cpp fallback) sidecar through these commands.

### `voice_sidecar_available`

```rust
async fn voice_sidecar_available(app: AppHandle) -> Result<bool, String>
```

Reports whether the bundled voice sidecar binary is on disk at runtime.
Search order: Tauri resource dir `binaries/parakeet[.exe]` (or
`whisper[.exe]`), then dev fallbacks under `src-tauri/binaries/`. Returns
`false` if no match. Frontend wrapper: `voiceSidecarAvailable()` in
`tauri-commands.ts`.

### `transcribe_audio`

```rust
async fn transcribe_audio(
  app: AppHandle,
  wav_bytes: Vec<u8>,
  model: Option<String>,
) -> Result<TranscribeResult, String>

struct TranscribeResult { text: String, latencyMs: u64 }
```

Spawns the sidecar with the WAV bytes on stdin; captures stdout as the
transcription. Hard-capped at 30 seconds (voice input is expected to be
short). Returns structured JSON (`camelCase` on the wire). Errors if the
binary is missing, the spawn fails, the process exits non-zero, or the
timeout elapses.

**Frontend:**
```ts
import { transcribeAudio } from '@/utils/tauri-commands';
const result = await transcribeAudio(wavBytes, 'small');
console.log(result.text, result.latencyMs);
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
