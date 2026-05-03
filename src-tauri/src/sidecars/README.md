# Sidecars

Tauri sidecars: small binaries bundled with the desktop app, spawned for specialized work (voice transcription, TTS, future: OCR, embeddings).

## Pattern

All sidecars implement the `Sidecar` trait:

```rust
pub trait Sidecar: Send + Sync {
    fn name(&self) -> &str;
    fn binary_path(&self) -> PathBuf;
    fn start(&mut self) -> Result<()>;
    fn stop(&mut self) -> Result<()>;
    fn is_running(&self) -> bool;
}
```

## Lifecycle shapes

The trait accommodates two distinct patterns:

**Long-lived (daemon):** `start()` once on app init, reuse for all requests, `stop()` on quit. `is_running()` reflects whether the process is alive. Suitable for TTS (Piper) where cold-start latency is perceptible.

**Fire-and-forget (per-request):** `start()` and `stop()` are no-ops; each request spawns a fresh process. `is_running()` always returns false. Suitable for Parakeet voice transcription where the binary exits after each WAV.

## Existing implementations

- `ParakeetSidecar` (`parakeet.rs`): voice input transcription (Parakeet.cpp or whisper.cpp). Used via `commands::voice::transcribe_audio` Tauri command. Fire-and-forget pattern.

## Stream B will add

- `PiperSidecar` (`piper.rs`): text-to-speech. Will be used by a `tts_speak` Tauri command. Long-lived daemon pattern (keep-warm for low-latency responses).

## Lifecycle contract

- Lazy spawn on first use (cold-start once, warm reuse for long-lived impls)
- Kept alive across requests where applicable
- Stopped on app quit (Tauri `on_drop` or setup hook)
- Auto-restart on crash (max 3 retries — to be implemented in manager layer)

## Adding a new sidecar

1. Create `src/sidecars/<name>.rs`
2. Implement `Sidecar` for your struct, choosing the appropriate lifecycle shape
3. Add `pub mod <name>; pub use <name>::<Name>Sidecar;` in `mod.rs`
4. Register with the Tauri app in `lib.rs` setup hook if it needs eager init
5. Add tests covering: `name()`, `binary_path()`, lifecycle no-op or real behavior, and the per-request call method
