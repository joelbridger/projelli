// ParakeetSidecar — voice transcription via a bundled whisper.cpp-family CLI.
//
// Lifecycle shape: fire-and-forget (per-request subprocess).
// Unlike a daemon sidecar, the engine is spawned fresh for every
// transcription request and exits when done.
//
// Consequently:
//   - start() / stop() are no-ops (nothing to persist)
//   - is_running() always returns false (no resident process)
//
// The real work is done by `transcribe()`, which is specific to this engine
// family and lives outside the generic Sidecar trait.
//
// Concurrency note: `binary` and `models_dir` never escape this struct
// between calls, so the required `Send + Sync` bounds are trivially
// satisfied.
//
// REAL ENGINE CONTRACT (verified 2026-07-04 against a locally-built
// ggml-org/whisper.cpp: `cmake -B build -DBUILD_SHARED_LIBS=OFF && cmake
// --build build --target whisper-cli`, then `./build/bin/whisper-cli
// --help` and a real transcription of the project's own `samples/jfk.wav`):
//
//   - There is NO `--stdin` mode. Input is always a real file on disk,
//     given via `-f FNAME` / `--file FNAME`.
//   - The model is always a file path, given via `-m FNAME` / `--model
//     FNAME` — never a bare tier name like "small".
//   - `-np`/`--no-prints` + `-nt`/`--no-timestamps` together produce clean,
//     unadorned transcription text on stdout with no timestamps or extra
//     banners (engine log noise like `read_audio_data: ...` goes to
//     stderr, confirmed by capturing the two streams separately).
//   - Exit code is non-zero on failure (e.g. 3 when the model fails to
//     load).
//
// This one contract covers BOTH whisper-family and Parakeet-family models:
// they're loaded by the same binary through the same `-m` flag (the ggml
// file's own header carries the architecture — see whisper.cpp's
// `models/convert-parakeet-to-ggml.py`, which converts NVIDIA Parakeet
// checkpoints into a ggml file explicitly described as "compatible with
// whisper.cpp"). So there is exactly one real CLI contract to support, not
// one per binary name. The previous `--stdin`-for-"whisper" /
// dash-for-"parakeet" name-sniffing was written before any real engine
// existed to test against, and didn't match either engine once one was
// actually built and tried (see docs/evidence/meetings-verify-20260704/
// RUN-LOG.md's "SIDECAR STAGING addendum").

use super::Sidecar;
use anyhow::{Context, Result};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// Hard cap on a single transcription. Mirrors the constant in
/// `commands/voice.rs` so both call-sites enforce the same limit.
const TRANSCRIBE_TIMEOUT_SECS: u64 = 30;

/// Per-request transcription result. Mirrors `TranscribeResult` in
/// `commands/voice.rs` (kept separate to avoid coupling the sidecar module
/// to the Tauri command layer).
#[derive(Debug)]
pub struct TranscribeOutput {
    pub text: String,
    pub latency_ms: u64,
}

/// (tier, model filename) pairs for the models we actually bundle today.
/// Order is the fallback preference `resolve_model_path` walks when the
/// requested tier's file isn't staged — cheapest/smallest first, since a
/// missing tier is most likely "not bundled to save install size" rather
/// than "install is broken".
///
/// `small` (466 MB) is not currently fetched/staged (see
/// `scripts/fetch-voice-models.sh`) — an install-size trade-off, not an
/// oversight — so a `small` request honestly falls back to `base`.
const MODEL_TIERS: &[(&str, &str)] = &[
    ("tiny", "ggml-tiny.en.bin"),
    ("base", "ggml-base.en.bin"),
    ("small", "ggml-small.en.bin"),
];

/// Default tier when the caller doesn't specify one. Matches `voiceModel`'s
/// `defaultValue` in `src/platform/settings/schema.ts`.
const DEFAULT_TIER: &str = "small";

/// Fallback order per requested tier when the exact match isn't staged,
/// most-preferred first — prefers the next tier UP (more accurate) before
/// falling down. Both `tiny` and `base` are actually bundled today (see
/// `scripts/fetch-voice-models.sh`), so a naive "walk `MODEL_TIERS` in
/// declared order" fallback would resolve every missing-`small` request
/// (the UI's own default/"(recommended)" tier) to `tiny` — the least
/// accurate model — purely because `tiny` sorts first in that list. That
/// silently gives every out-of-the-box user the worst model instead of the
/// intended `base`. Caught in review (Codex, 2026-07-04) before it shipped.
fn fallback_order(tier: &str) -> &'static [&'static str] {
    match tier {
        "tiny" => &["base", "small"],
        "base" => &["small", "tiny"],
        "small" => &["base", "tiny"],
        _ => &["small", "base", "tiny"],
    }
}

/// Resolve a UI tier name (tiny/base/small) to the actual bundled model file
/// under `models_dir`. Falls back per `fallback_order` when the exact tier
/// isn't staged — this engine always needs *some* model file (`-m` has no
/// usable default in a packaged app), so degrading gracefully beats failing
/// outright over an install-size trade-off. Returns `None` only when no
/// model is staged at all.
pub fn resolve_model_path(models_dir: &Path, tier: Option<&str>) -> Option<PathBuf> {
    let requested = tier.unwrap_or(DEFAULT_TIER);
    let filename_for = |t: &str| MODEL_TIERS.iter().find(|(k, _)| *k == t).map(|(_, f)| *f);

    let mut candidates: Vec<&str> = vec![requested];
    candidates.extend(fallback_order(requested));

    for t in candidates {
        if let Some(f) = filename_for(t) {
            let p = models_dir.join(f);
            if p.exists() {
                return Some(p);
            }
        }
    }
    None
}

pub struct ParakeetSidecar {
    binary: PathBuf,
    models_dir: Option<PathBuf>,
}

impl ParakeetSidecar {
    pub fn new(binary: PathBuf, models_dir: Option<PathBuf>) -> Self {
        Self { binary, models_dir }
    }

    /// Build the real CLI args: `-f <input> -np -nt [-m <model>]`. Exposed
    /// for unit tests without spawning a subprocess.
    pub fn build_args(input_wav_path: &Path, model_path: Option<&Path>) -> Vec<String> {
        let mut args = vec![
            "-f".to_string(),
            input_wav_path.to_string_lossy().into_owned(),
            "-np".to_string(),
            "-nt".to_string(),
        ];
        if let Some(m) = model_path {
            args.push("-m".to_string());
            args.push(m.to_string_lossy().into_owned());
        }
        args
    }

    /// Spawn a fresh subprocess against the real file-based contract: write
    /// the WAV bytes to a temp file (the engine has no stdin mode), pass its
    /// path via `-f`, and collect the transcription from stdout. The temp
    /// file is removed when `tmp` drops at the end of this function — both
    /// on success and on any early `?` return.
    pub async fn transcribe(&self, wav_bytes: Vec<u8>, model: Option<&str>) -> Result<TranscribeOutput> {
        use crate::util::proc::hide_console_tokio;
        use tokio::process::Command;
        use tokio::time::timeout;

        anyhow::ensure!(!wav_bytes.is_empty(), "wav_bytes is empty — nothing to transcribe");

        let model_path = self.models_dir.as_deref().and_then(|d| resolve_model_path(d, model));
        let model_path = model_path.ok_or_else(|| {
            anyhow::anyhow!(
                "no voice model bundled for this platform (expected a ggml model under \
                 resources/voice/models — see scripts/fetch-voice-models.sh)"
            )
        })?;

        let mut tmp = tempfile::Builder::new()
            .suffix(".wav")
            .tempfile()
            .context("failed to create a temp file for voice input")?;
        tmp.write_all(&wav_bytes).context("failed to write WAV bytes to temp file")?;
        tmp.flush().context("failed to flush WAV temp file")?;

        let args = Self::build_args(tmp.path(), Some(&model_path));
        let started = Instant::now();

        let mut cmd = Command::new(&self.binary);
        cmd.args(&args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            // `wait_with_output()` moves the child in, so a timeout firing on
            // the outer `timeout(...)` future just drops that future — it
            // does NOT kill the still-running process (verified: Tokio's
            // `Child` does not kill-on-drop by default). Without this, an
            // engine that hangs past TRANSCRIBE_TIMEOUT_SECS keeps running
            // in the background indefinitely, burning CPU with no way for
            // the caller to ever reap it. Caught in review (Codex,
            // 2026-07-04).
            .kill_on_drop(true);
        hide_console_tokio(&mut cmd);
        let child = cmd.spawn()?;

        let output = timeout(Duration::from_secs(TRANSCRIBE_TIMEOUT_SECS), child.wait_with_output())
            .await
            .map_err(|_| anyhow::anyhow!("voice sidecar timed out"))??;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow::anyhow!(
                "voice sidecar exited {}: {}",
                output.status.code().unwrap_or(-1),
                stderr.trim()
            ));
        }

        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(TranscribeOutput { text, latency_ms: started.elapsed().as_millis() as u64 })
    }
}

// Sidecar trait impl. For this fire-and-forget design, start/stop/is_running
// are intentional no-ops. The trait is implemented so ParakeetSidecar can be
// stored as a `Box<dyn Sidecar>` alongside future long-lived sidecars.
impl Sidecar for ParakeetSidecar {
    fn name(&self) -> &str {
        "parakeet"
    }

    fn binary_path(&self) -> PathBuf {
        self.binary.clone()
    }

    /// No-op: the engine is spawned per-request, not kept alive.
    fn start(&mut self) -> Result<()> {
        Ok(())
    }

    /// No-op: no resident process to terminate.
    fn stop(&mut self) -> Result<()> {
        Ok(())
    }

    /// Always false: no resident process between requests.
    fn is_running(&self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn sidecar(name: &str, models_dir: Option<PathBuf>) -> ParakeetSidecar {
        ParakeetSidecar::new(PathBuf::from(format!("/fake/bin/{name}")), models_dir)
    }

    // --- Sidecar trait ---

    #[test]
    fn name_is_parakeet() {
        let s = sidecar("parakeet", None);
        assert_eq!(s.name(), "parakeet");
    }

    #[test]
    fn binary_path_round_trips() {
        let path = PathBuf::from("/fake/bin/parakeet");
        let s = ParakeetSidecar::new(path.clone(), None);
        assert_eq!(s.binary_path(), path);
    }

    #[test]
    fn lifecycle_noop_does_not_panic() {
        let mut s = sidecar("parakeet", None);
        s.start().unwrap();
        assert!(!s.is_running());
        s.stop().unwrap();
        assert!(!s.is_running());
    }

    // --- build_args: the real, verified whisper.cpp-family contract ---

    #[test]
    fn build_args_real_contract_with_model() {
        let input = PathBuf::from("/tmp/rec.wav");
        let model = PathBuf::from("/opt/models/ggml-base.en.bin");
        let args = ParakeetSidecar::build_args(&input, Some(&model));
        assert_eq!(
            args,
            vec![
                "-f".to_string(),
                "/tmp/rec.wav".to_string(),
                "-np".to_string(),
                "-nt".to_string(),
                "-m".to_string(),
                "/opt/models/ggml-base.en.bin".to_string(),
            ]
        );
    }

    #[test]
    fn build_args_no_model_omits_dash_m() {
        let args = ParakeetSidecar::build_args(Path::new("/tmp/rec.wav"), None);
        assert!(!args.contains(&"-m".to_string()));
        assert_eq!(args, vec!["-f", "/tmp/rec.wav", "-np", "-nt"]);
    }

    #[test]
    fn build_args_never_uses_stdin_mode() {
        // Real whisper-cli --help has no --stdin flag at all — verified
        // against a real build, not assumed. Guard against regressing back
        // to the old, never-tested contract.
        let args = ParakeetSidecar::build_args(Path::new("/tmp/rec.wav"), None);
        assert!(!args.iter().any(|a| a == "--stdin"));
        assert!(!args.iter().any(|a| a == "-"), "no bare stdin-marker positional arg either");
    }

    // --- resolve_model_path: tier -> file, with honest fallback ---

    #[test]
    fn resolve_model_path_exact_tier_match() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("ggml-tiny.en.bin"), b"x").unwrap();
        fs::write(dir.path().join("ggml-base.en.bin"), b"x").unwrap();
        let p = resolve_model_path(dir.path(), Some("tiny")).unwrap();
        assert_eq!(p, dir.path().join("ggml-tiny.en.bin"));
    }

    #[test]
    fn resolve_model_path_falls_back_when_requested_tier_missing() {
        let dir = tempdir().unwrap();
        // Only `base` staged — mirrors the real bundling trade-off where
        // `small` (466 MB) is skipped.
        fs::write(dir.path().join("ggml-base.en.bin"), b"x").unwrap();
        let p = resolve_model_path(dir.path(), Some("small")).unwrap();
        assert_eq!(p, dir.path().join("ggml-base.en.bin"));
    }

    #[test]
    fn resolve_model_path_defaults_to_small_tier_when_none_given() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("ggml-small.en.bin"), b"x").unwrap();
        let p = resolve_model_path(dir.path(), None).unwrap();
        assert_eq!(p, dir.path().join("ggml-small.en.bin"));
    }

    #[test]
    fn resolve_model_path_none_when_nothing_staged() {
        let dir = tempdir().unwrap();
        assert!(resolve_model_path(dir.path(), Some("tiny")).is_none());
    }

    #[test]
    fn resolve_model_path_default_tier_prefers_base_over_tiny_in_the_real_bundle() {
        // Regression test for a review finding (Codex, 2026-07-04): both
        // `tiny` and `base` are actually staged in the real bundle (see
        // scripts/fetch-voice-models.sh), `small` never is. A naive
        // walk-MODEL_TIERS-in-order fallback would resolve every default
        // ("small") request to `tiny` just because it sorts first — silently
        // giving every out-of-the-box user the least accurate model. It
        // must resolve to `base` instead.
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("ggml-tiny.en.bin"), b"x").unwrap();
        fs::write(dir.path().join("ggml-base.en.bin"), b"x").unwrap();
        let p = resolve_model_path(dir.path(), None).unwrap();
        assert_eq!(p, dir.path().join("ggml-base.en.bin"));
        let p = resolve_model_path(dir.path(), Some("small")).unwrap();
        assert_eq!(p, dir.path().join("ggml-base.en.bin"));
    }

    // --- transcribe(): error paths (no subprocess actually starts, or the
    // stub binary is trivially wrong) ---

    #[tokio::test]
    async fn transcribe_errors_on_empty_wav_bytes() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("ggml-base.en.bin"), b"x").unwrap();
        let s = ParakeetSidecar::new(PathBuf::from("/bin/true"), Some(dir.path().to_path_buf()));
        let result = s.transcribe(vec![], None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn transcribe_errors_when_no_model_available() {
        let s = ParakeetSidecar::new(PathBuf::from("/bin/true"), None);
        let result = s.transcribe(b"fake_wav".to_vec(), Some("tiny")).await;
        let err = result.unwrap_err().to_string();
        assert!(err.contains("model"), "expected a model-related error, got: {err}");
    }

    #[tokio::test]
    async fn transcribe_errors_when_binary_missing() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("ggml-base.en.bin"), b"x").unwrap();
        let s =
            ParakeetSidecar::new(PathBuf::from("/nonexistent-parakeet-abc"), Some(dir.path().to_path_buf()));
        let result = s.transcribe(b"fake_wav".to_vec(), None).await;
        assert!(result.is_err(), "expected error when binary is missing");
    }

    // --- transcribe(): full lifecycle against a stub engine that speaks the
    // real file-based contract, proving the temp-file write + cleanup and
    // arg-passing actually work end to end (not just the pure arg builder).
    // Shell-script stub is fine here: `cargo test` only runs on the Linux CI
    // runner (see .github/workflows/ci.yml) and this dev box, never Windows —
    // `#[cfg(unix)]` documents that rather than silently relying on it.

    #[cfg(unix)]
    const FAKE_ENGINE_SCRIPT: &str = "#!/bin/sh\n\
        f=\"\"\n\
        while [ $# -gt 0 ]; do\n\
          case \"$1\" in\n\
            -f) f=\"$2\"; shift 2 ;;\n\
            -m) shift 2 ;;\n\
            -np|-nt) shift ;;\n\
            *) shift ;;\n\
          esac\n\
        done\n\
        printf '%s bytes at %s' \"$(wc -c < \"$f\" | tr -d ' ')\" \"$f\"\n";

    #[cfg(unix)]
    #[tokio::test]
    async fn transcribe_writes_wav_to_tempfile_and_cleans_up_after() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempdir().unwrap();
        let models_dir = dir.path().join("models");
        fs::create_dir_all(&models_dir).unwrap();
        fs::write(models_dir.join("ggml-base.en.bin"), b"m").unwrap();

        let fake_engine = dir.path().join("fake-whisper.sh");
        fs::write(&fake_engine, FAKE_ENGINE_SCRIPT).unwrap();
        let mut perms = fs::metadata(&fake_engine).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&fake_engine, perms).unwrap();

        let sidecar = ParakeetSidecar::new(fake_engine, Some(models_dir));
        let wav = b"RIFF-fake-wav-bytes-1234".to_vec();
        let out = sidecar.transcribe(wav.clone(), Some("base")).await.unwrap();

        assert!(
            out.text.starts_with(&wav.len().to_string()),
            "expected the fake engine's reported byte count ({}) at the start of: {}",
            wav.len(),
            out.text
        );
        let reported_path = out.text.split("bytes at ").nth(1).expect("fake engine reports the path it saw");
        assert!(
            !Path::new(reported_path).exists(),
            "temp WAV file was not cleaned up: {reported_path}"
        );
    }

    // --- transcribe(): a genuinely wedged engine (QA-40) ---
    //
    // meetings-verify3 (docs/evidence/meetings-verify3-20260704/RUN-LOG.md)
    // reported a multi-minute "hang" transcribing a real recording's second
    // (sys) channel. Root-caused (QA-40) to NOT be an engine hang at all: the
    // Legion's models dir was staged at the pre-voicefix shim's path
    // (binaries/whisper-engine/models/), not resources/voice/models/ where
    // resolve_models_dir actually looks, so every real call failed in ~125ms
    // with "no voice model bundled" — and meetingStore.ts's bare `catch {}`
    // around transcribe_meeting silently swallowed that fast failure,
    // making it indistinguishable from a permanent hang. That silent-catch
    // is fixed in meetingStore.ts (QA-40) and the Legion's models dir was
    // restaged to the correct path.
    //
    // Separately, THIS test proves the engine-level protection that would
    // matter if the engine itself ever genuinely wedges (hangs mid-call,
    // consuming no CPU, never exiting): TRANSCRIBE_TIMEOUT_SECS +
    // kill_on_drop must turn that into a bounded, classified timeout error
    // AND actually reap the stuck process — not just error out while leaving
    // it running in the background forever. Confirms the fake engine is
    // actually running (real wall-clock wait — a real subprocess, unaffected
    // by tokio's virtual clock) BEFORE pausing time, then fast-forwards past
    // the 30s bound without a real 30s wait. Pausing only after the child is
    // confirmed running (rather than `#[tokio::test(start_paused = true)]`
    // from the start) matters: on the default current-thread runtime, time
    // only advances for a task that yields via `.await` — a real blocking
    // wait (`std::thread::sleep`) would starve the executor and the spawned
    // task (and therefore the child process) would never even start.
    #[cfg(unix)]
    const FAKE_HANG_SCRIPT: &str = "#!/bin/sh\n\
        m=\"\"\n\
        while [ $# -gt 0 ]; do\n\
          case \"$1\" in\n\
            -f) shift 2 ;;\n\
            -m) m=\"$2\"; shift 2 ;;\n\
            -np|-nt) shift ;;\n\
            *) shift ;;\n\
          esac\n\
        done\n\
        echo $$ > \"$m.pid\"\n\
        exec sleep 999999\n";

    #[cfg(unix)]
    #[tokio::test]
    async fn transcribe_kills_a_wedged_engine_and_returns_a_bounded_timeout_error() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempdir().unwrap();
        let models_dir = dir.path().join("models");
        fs::create_dir_all(&models_dir).unwrap();
        let model_path = models_dir.join("ggml-base.en.bin");
        fs::write(&model_path, b"m").unwrap();

        let fake_engine = dir.path().join("hang-forever.sh");
        fs::write(&fake_engine, FAKE_HANG_SCRIPT).unwrap();
        let mut perms = fs::metadata(&fake_engine).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&fake_engine, perms).unwrap();

        let sidecar = ParakeetSidecar::new(fake_engine, Some(models_dir));
        let wav = b"RIFF-fake-wav-bytes-1234".to_vec();

        // Real subprocess, driven on a spawned task the runtime keeps polling
        // concurrently with this test task — the fake engine never exits on
        // its own, so the only way the spawned task ever resolves is the
        // internal `tokio::time::timeout` firing.
        let handle = tokio::spawn(async move { sidecar.transcribe(wav, Some("base")).await });

        // Real-time wait (time is NOT paused yet) for the fake engine to
        // actually be running before asserting anything about it having been
        // killed. A normal `.await`ed sleep lets the executor keep polling
        // the spawned task concurrently, unlike a blocking `std::thread::sleep`.
        let pidfile = PathBuf::from(format!("{}.pid", model_path.display()));
        let mut pid: Option<u32> = None;
        for _ in 0..500 {
            if let Ok(s) = fs::read_to_string(&pidfile) {
                if let Ok(p) = s.trim().parse() {
                    pid = Some(p);
                    break;
                }
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let pid = pid.expect("fake engine never wrote its pidfile — did it start?");
        assert!(
            Path::new(&format!("/proc/{pid}")).exists(),
            "fake engine (pid {pid}) should be running before the timeout fires"
        );

        // NOW pause time and fast-forward past the sidecar's own bound — the
        // internal timeout timer was armed before the engine ever started,
        // so it's still correctly tracked once we take over the clock.
        tokio::time::pause();
        tokio::time::advance(Duration::from_secs(TRANSCRIBE_TIMEOUT_SECS + 5)).await;

        let result = handle.await.unwrap();
        let err = result.unwrap_err().to_string();
        assert!(err.contains("timed out"), "expected a timeout error, got: {err}");

        // The whole point of kill_on_drop: a wedged engine must not keep
        // running in the background after the caller has given up on it.
        // `handle` has already resolved above, so nothing else needs polling
        // here — a plain blocking sleep is fine.
        for _ in 0..200 {
            if !Path::new(&format!("/proc/{pid}")).exists() {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("fake engine (pid {pid}) is still running after the timeout — kill_on_drop did not reap it");
    }

    // --- Real-engine end-to-end verification (opt-in, not part of the
    // automated gate). CI/gate don't vendor a real whisper.cpp binary or
    // model for hermetic unit tests — this proves the actual contract
    // against a real build, run manually:
    //
    //   REAL_WHISPER_CLI=/path/to/whisper-cli \
    //   REAL_WHISPER_MODEL=/path/to/ggml-base.en.bin \
    //   REAL_WHISPER_WAV=/path/to/samples/jfk.wav \
    //   cargo test --package lantern transcribe_real_whisper_cli_end_to_end -- --ignored --nocapture

    #[tokio::test]
    #[ignore = "requires a real whisper.cpp binary + model; run manually, see doc comment"]
    async fn transcribe_real_whisper_cli_end_to_end() {
        let bin = std::env::var("REAL_WHISPER_CLI").expect("set REAL_WHISPER_CLI");
        let model = std::env::var("REAL_WHISPER_MODEL").expect("set REAL_WHISPER_MODEL");
        let wav_path = std::env::var("REAL_WHISPER_WAV").expect("set REAL_WHISPER_WAV");

        let model_path = PathBuf::from(&model);
        let filename = model_path.file_name().unwrap().to_string_lossy().into_owned();
        let tier = MODEL_TIERS
            .iter()
            .find(|(_, f)| *f == filename)
            .map(|(t, _)| *t)
            .unwrap_or_else(|| panic!("REAL_WHISPER_MODEL must be named one of {MODEL_TIERS:?}, got {filename}"));
        let models_dir = model_path.parent().unwrap().to_path_buf();

        let sidecar = ParakeetSidecar::new(PathBuf::from(bin), Some(models_dir));
        let wav_bytes = fs::read(&wav_path).expect("read REAL_WHISPER_WAV");
        let out = sidecar.transcribe(wav_bytes, Some(tier)).await.expect("real transcription should succeed");

        assert!(!out.text.trim().is_empty(), "expected real transcribed text, got empty string");
        println!("real whisper-cli transcription: {:?} ({}ms)", out.text, out.latency_ms);
    }
}
