// Sidecar trait — shared lifecycle contract for all bundled helper binaries.
//
// Advisor Prep Hero bundles small native binaries for specialized work that can't
// happen inside the Wasm/JS sandbox:
//
//   - ParakeetSidecar  : voice transcription (parakeet / whisper.cpp)
//   - PiperSidecar     : text-to-speech (Stream B, not yet added)
//   - LlamaServerSidecar : local LLM generation (llama.cpp server)
//
// The two main lifecycle shapes that impls may take:
//
//   Long-lived (persistent process): start() once, call repeatedly, stop()
//   on quit. `is_running()` reflects whether the process is still alive.
//
//   Per-request (fire-and-forget): start() / stop() are no-ops; every
//   "call" spawns a fresh process. `is_running()` always returns false.
//
// Callers that only need to dispatch a request should use the higher-level
// methods defined on each concrete impl, not this trait directly.

use anyhow::Result;
use std::path::PathBuf;

pub mod parakeet;
pub use parakeet::ParakeetSidecar;
pub mod piper;
pub use piper::PiperSidecar;
pub mod llama_server;
pub use llama_server::LlamaServerSidecar;
pub mod diarize;
pub use diarize::DiarizeSidecar;

pub trait Sidecar: Send + Sync {
    fn name(&self) -> &str;
    fn binary_path(&self) -> PathBuf;
    fn start(&mut self) -> Result<()>;
    fn stop(&mut self) -> Result<()>;
    fn is_running(&self) -> bool;
}

#[cfg(test)]
mod tests {
    use super::*;

    struct DummySidecar {
        running: bool,
    }

    impl Sidecar for DummySidecar {
        fn name(&self) -> &str {
            "dummy"
        }
        fn binary_path(&self) -> PathBuf {
            PathBuf::from("/bin/true")
        }
        fn start(&mut self) -> Result<()> {
            self.running = true;
            Ok(())
        }
        fn stop(&mut self) -> Result<()> {
            self.running = false;
            Ok(())
        }
        fn is_running(&self) -> bool {
            self.running
        }
    }

    #[test]
    fn trait_compiles_and_lifecycle_works() {
        let mut s = DummySidecar { running: false };
        assert!(!s.is_running());
        s.start().unwrap();
        assert!(s.is_running());
        s.stop().unwrap();
        assert!(!s.is_running());
    }

    #[test]
    fn name_returns_static_str() {
        let s = DummySidecar { running: false };
        assert_eq!(s.name(), "dummy");
    }
}
