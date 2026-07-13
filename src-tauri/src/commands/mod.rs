// Business OS - Tauri Commands Module
// Custom commands for native functionality.
//
// Phase 2 of the v1.5 release adds the Rust/Tauri foundation the Memory
// (Phase 3, M1-M3), MCP/Canvas/Voice (Phase 4, M4-M6), and deferred Quick
// Wins (Q12 URL smart paste, Q13 image paste) all build on.

pub mod fs;
pub mod http;
pub mod keychain;
// Symlink-safe workspace-path containment (2026-07-04 hardening pass).
// Every command that resolves a caller-supplied path against a workspace or
// matter root goes through here instead of duplicating its own
// canonicalize+starts_with check, which follows symlinks and can be tricked
// by an in-workspace alias directory into touching a different client's
// files. `pub` (not `pub(crate)`) so the `lantern-mcp` sidecar binary can
// reuse it too — see the module doc comment.
pub mod pathguard;
// Single seam for resolving the per-workspace internal data folder
// (`.lantern`), the vault-metadata file, and the OS-level data subdir.
// Dev-data reset is approved for the Lantern rename, so old folders are not
// migrated.
pub mod data_dir;
// Advisor Prep Hero 3.0 — SQLCipher-encrypted, append-only audit "defense file" store.
pub mod audit;
// Read-only Addepar portfolio connector — household holdings/performance into RAG.
pub mod addepar;
// Wealthbox CRM connector (Phase 1A) — CRM RAG ingestion bridge.
pub mod crm;
// Lantern Intake — encrypted per-client facts store + audit-gated commands.
pub mod intake;
// Lantern-Plus Track 2 — approval-gated external write-back sockets.
pub mod writeback;
// Read-only DocuSign connector — completed envelopes + signing audit trail.
pub mod docusign;
// Read-only Jotform connector — intake/KYC submissions into client memory.
pub mod jotform;
// Read-only Zocks connector — meeting notes/transcripts into client memory.
pub mod zocks;
// Calendar connector — read-only Outlook/Google/ICS events into meeting RAG + Client Map prep.
pub mod calendar;
// Calendly connector — read-only scheduled events + invitee intake into meeting RAG.
pub mod calendly;
// Shared additive connector foundation — generic external RAG ingestion bridge.
pub mod connector;
// The only native HTTP doorway CRM connectors may use. It authorizes every
// request, retry, and page against Network Lockdown before a socket can open.
pub mod connector_network;
// M365 email-import (Task 1+) — pure-Rust Graph JSON parsing, local index, sync.
pub mod mail;
// Read-only OneDrive / SharePoint document connector.
pub mod onedrive;
// Read-only Box document connector.
pub mod boxc;
// Read-only ShareFile document connector.
pub mod sharefile;
// Phase 4 M4 (v1.5 Flag 2) — host-side bridge for the Advisor Prep Hero MCP sidecar:
// list pending write approvals, record the user's decision, resolve the
// platform `.mcpb` bundle path.
pub mod mcp;
pub mod rag;
// Advisor Prep Hero Local AI — bundled llama.cpp sidecar plus first-run GGUF download.
pub mod local_llm;
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
// WS-A / A1 (v3.0): in-house OOXML (.docx) document engine command layer.
// Thin wrappers over the `lantern-docx` crate: open a .docx into the JSON DOM
// the editor renders, save the DOM back preserving unmodeled parts, and author
// AI tracked changes (the helper A4 calls).
pub mod docx;
// Wave 3a SSO (OIDC) — firm-tier desktop commands: loopback command that
// drives the full OIDC dance (bind port → sso/start → browser → exchange).
pub mod firm;
// Wave 3b encrypted vault — create/status/read/write + keychain VMK integration.
pub mod vault;
// Onboarding/setup progress aggregator — unifies the 5 per-source progress
// signals (AI/models, email, Wealthbox CRM, file indexing, Client Map) into one
// queryable `get_setup_progress` snapshot + a `setup-progress-changed` event.
pub mod setup_progress;
// Lantern-Plus Wave 3a — local meeting capture (mic + system-audio loopback,
// crash-durable chunked WAV, never a cloud path).
pub mod capture;
// Wave 4 Track A — within-channel speaker diarization: system-channel
// extraction + sherpa-onnx turn assignment onto Wave 3 transcripts.
pub mod diarize;
// Wave 4 Track A — encrypted per-matter voiceprint store + naming commands.
pub mod voiceprint;
// Wave 4 Track D — per-workspace retention policy sweep enforcing the capture
// location contract (audio.wav, chunk caches, transcript.json in summary-only).
pub mod retention;
// Notice Card — isolated companion-webview commands: open/close/status of the
// guest-join window that shows participants the recording-notice card. The
// window inherits NO app capabilities (label-scoped isolation); status flows
// out one-way via document.title. See notice_card/mod.rs for the full model.
pub mod notice_card;
