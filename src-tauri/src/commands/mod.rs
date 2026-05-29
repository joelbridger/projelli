// Business OS - Tauri Commands Module
// Custom commands for native functionality.
//
// Phase 2 of the v1.5 release adds the Rust/Tauri foundation the Memory
// (Phase 3, M1-M3), MCP/Canvas/Voice (Phase 4, M4-M6), and deferred Quick
// Wins (Q12 URL smart paste, Q13 image paste) all build on.

pub mod fs;
pub mod http;
pub mod keychain;
// Phase 4 M4 (v1.5 Flag 2) — host-side bridge for the Keepance MCP sidecar:
// list pending write approvals, record the user's decision, resolve the
// platform `.mcpb` bundle path.
pub mod mcp;
pub mod rag;
// Phase 4 M6 (v1.5 Flag 4) — voice capture & transcription via bundled
// Parakeet/whisper.cpp sidecar. Frontend press-to-talk hotkey invokes
// `transcribe_audio(wav_bytes)` with WAV bytes captured via
// `navigator.mediaDevices.getUserMedia` + `MediaRecorder`.
pub mod voice;
pub mod watcher;
// Stream B TTS (v2.0) — synthesize speech via the bundled Piper sidecar.
pub mod tts;
// Stream C1 (v2.0): Templates Marketplace install pipeline. SHA-256 file
// hashing and gzipped-tarball extraction with path-traversal hardening.
pub mod checksum;
pub mod tarball;
