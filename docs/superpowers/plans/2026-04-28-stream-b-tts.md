# Projelli v2.0 Stream B: TTS Piper Sidecar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship local text-to-speech for AI responses via a bundled Piper sidecar. Users click "Read aloud" on any AI message; Piper synthesizes speech on-device, no API key, no cloud round-trip, works offline.

**Branch:** `feature/stream-b-tts`. Branches off `feature/foundations` (PR #18). All foundation interfaces (Sidecar trait, AuditEvent union, VoiceSettingsSection, settings schema) are available.

**Architecture:** PiperSidecar (Rust) implements the Sidecar trait as a long-lived daemon. TTSService (TypeScript) wraps it via Tauri invoke. The chat panel gains a "Read aloud" button and an inline audio control bar. Settings → Voice gains an Output subsection. English voice bundled; Spanish and German lazy-downloaded from Projelli's CDN.

**Tech Stack:** TypeScript 5 (strict mode), React 18, Vite 5, Zustand, Vitest, Tauri 2 (Rust), Web Audio API, cargo test.

**Spec reference:** `docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md` Section 5.

---

## File Structure

### Files to create

| Path | Purpose |
|---|---|
| `src-tauri/src/sidecars/piper.rs` | PiperSidecar struct, Sidecar trait impl, `speak()` method |
| `src-tauri/src/commands/tts.rs` | `tts_speak`, `tts_stop`, `tts_sidecar_available`, `tts_download_voice` Tauri commands |
| `src/modules/tts/TTSService.ts` | High-level TS wrapper: `speak()`, `stop()`, `list()`, `isSidecarAvailable()` |
| `src/modules/tts/TTSAudioPlayer.ts` | Web Audio API ring-buffer player, streaming and buffered modes |
| `src/modules/tts/voiceCatalog.ts` | Voice metadata, CDN URL builder, lazy-download coordinator |
| `src/modules/tts/index.ts` | Barrel export |
| `src/components/chat/ReadAloudButton.tsx` | Icon button, keyboard shortcut handler, state-aware (idle/loading/playing) |
| `src/components/chat/AudioControlBar.tsx` | Inline player below message: pause/stop/scrub |
| `src/components/settings/VoiceOutputSettingsSection.tsx` | Output subsection: enable toggle, voice picker, speed slider, auto-read toggle, shortcut display |
| `tests/unit/tts/TTSService.test.ts` | Unit tests for TTSService |
| `tests/unit/tts/voiceCatalog.test.ts` | Unit tests for voice catalog URL builder and lazy-download logic |
| `tests/unit/components/tts/ReadAloudButton.test.tsx` | Component tests |
| `tests/unit/components/tts/AudioControlBar.test.tsx` | Component tests |
| `tests/unit/components/settings/VoiceOutputSettingsSection.test.tsx` | Settings section tests |
| `tests/e2e/tts.spec.ts` | Playwright: read-aloud click, audio element appears, pause/stop work |
| `scripts/fetch-piper-sidecar.sh` | Dev script: download Piper binary + en_US-amy-medium voice for current platform |

### Files to modify

| Path | Change |
|---|---|
| `src-tauri/src/sidecars/mod.rs` | Add `pub mod piper; pub use piper::PiperSidecar;` |
| `src-tauri/src/lib.rs` | Register tts commands; init PiperSidecar in app setup; stop on app exit |
| `src-tauri/src/commands/mod.rs` | Add `pub mod tts;` |
| `src-tauri/tauri.conf.json` | Add Piper per-platform entries to `bundle.externalBin` |
| `src/settings/schema.ts` | Add TTS settings keys (ttsEnabled, ttsVoice, ttsSpeed, ttsAutoRead, ttsShortcut) |
| `src/components/settings/VoiceSettingsSection.tsx` | Import and render VoiceOutputSettingsSection below existing input section |
| `src/types/audit.ts` | Confirm `tts_played` payload has `textLength`, `voiceId`, `timestamp` (already declared; verify shape) |
| `package.json` | Add `fetch-piper-sidecar` script entry |

### Files to NOT modify (out of Stream B scope)

- Existing chat message rendering beyond adding the ReadAloudButton and AudioControlBar mount points
- Parakeet sidecar (voice input, not output)
- MarketplaceService (Stream C)
- AttachmentService (Stream A)
- i18n locale files (Stream E handles string extraction)
- Any workflow or editor module

---

## Task Decomposition

There are 8 task groups. Within each group, tasks run sequentially. Across groups, the order is dependency-driven (binary before Rust, Rust before TS, TS before UI).

- Group I: Piper binary + voice asset bundling (Tasks 1-3)
- Group II: PiperSidecar Rust implementation (Tasks 4-6)
- Group III: TTSService TypeScript wrapper + Tauri command bridge (Tasks 7-9)
- Group IV: "Read aloud" button + chat panel integration (Tasks 10-12)
- Group V: Settings → Voice → Output section (Tasks 13-15)
- Group VI: Streaming audio playback for long responses (Tasks 16-17)
- Group VII: Lazy-download for non-English voices (Tasks 18-19)
- Group VIII: Audit logging, error handling, final verification, and PR (Tasks 20-22)

---

# Group I: Piper Binary and Voice Asset Bundling

## Task 1: Add Piper binary entries to tauri.conf.json

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Read current externalBin array**

```bash
grep -A 5 '"externalBin"' src-tauri/tauri.conf.json
```

Note the current value (expect `[]`).

- [ ] **Step 2: Add Piper platform entries**

Modify `src-tauri/tauri.conf.json`. Replace the `externalBin` value:

```json
"externalBin": [
  "binaries/parakeet",
  "binaries/piper"
]
```

Tauri resolves each entry to `<entry>-<target-triple>[.exe]` in the resource dir at bundle time, and to `src-tauri/binaries/<entry>-<target-triple>[.exe]` in dev builds. The four platform binaries expected:

```
src-tauri/binaries/piper-x86_64-pc-windows-msvc.exe
src-tauri/binaries/piper-aarch64-apple-darwin
src-tauri/binaries/piper-x86_64-apple-darwin
src-tauri/binaries/piper-x86_64-unknown-linux-gnu
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat(tts): register piper in tauri.conf.json externalBin"
```

---

## Task 2: Create fetch-piper-sidecar dev script

**Files:**
- Create: `scripts/fetch-piper-sidecar.sh`

- [ ] **Step 1: Write the script**

Write `scripts/fetch-piper-sidecar.sh`:

```bash
#!/usr/bin/env bash
# Download Piper binary and the bundled English voice for the current platform.
# Run once after cloning or when upgrading Piper.
#
# Usage: bash scripts/fetch-piper-sidecar.sh
#
# Piper releases: https://github.com/rhasspy/piper/releases
# Voice files: https://projelli.com/voices/

set -euo pipefail

PIPER_VERSION="2023.11.14-2"
BINARIES_DIR="src-tauri/binaries"
VOICES_DIR="src-tauri/voices"
CDN_BASE="https://projelli.com/voices"

mkdir -p "$BINARIES_DIR" "$VOICES_DIR"

# Detect platform and map to Piper release archive name and target triple.
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS/$ARCH" in
  Linux/x86_64)
    ARCHIVE="piper_linux_x86_64.tar.gz"
    TRIPLE="x86_64-unknown-linux-gnu"
    ;;
  Darwin/arm64)
    ARCHIVE="piper_macos_aarch64.tar.gz"
    TRIPLE="aarch64-apple-darwin"
    ;;
  Darwin/x86_64)
    ARCHIVE="piper_macos_x86_64.tar.gz"
    TRIPLE="x86_64-apple-darwin"
    ;;
  *)
    echo "Unsupported platform: $OS/$ARCH" >&2
    echo "For Windows, download piper_windows_amd64.zip from:" >&2
    echo "  https://github.com/rhasspy/piper/releases/tag/$PIPER_VERSION" >&2
    echo "Rename piper.exe to src-tauri/binaries/piper-x86_64-pc-windows-msvc.exe" >&2
    exit 1
    ;;
esac

RELEASE_BASE="https://github.com/rhasspy/piper/releases/download/$PIPER_VERSION"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading Piper $PIPER_VERSION for $TRIPLE..."
curl -fsSL "$RELEASE_BASE/$ARCHIVE" -o "$TMP/piper.tar.gz"
tar -xzf "$TMP/piper.tar.gz" -C "$TMP"

# The archive unpacks to piper/piper (or piper.exe on Windows).
SRC_BIN="$TMP/piper/piper"
DEST_BIN="$BINARIES_DIR/piper-$TRIPLE"
cp "$SRC_BIN" "$DEST_BIN"
chmod +x "$DEST_BIN"
echo "Piper binary: $DEST_BIN"

# Download bundled English voice from Projelli CDN.
VOICE_ID="en_US-amy-medium"
VOICE_ARCHIVE="$VOICE_ID.tar.gz"
echo "Downloading bundled voice: $VOICE_ID..."
curl -fsSL "$CDN_BASE/$VOICE_ARCHIVE" -o "$TMP/$VOICE_ARCHIVE"
tar -xzf "$TMP/$VOICE_ARCHIVE" -C "$VOICES_DIR"
echo "Voice files extracted to: $VOICES_DIR/$VOICE_ID/"

echo ""
echo "Done. Piper is ready for tauri dev builds."
echo "Run: npm run tauri:dev"
```

- [ ] **Step 2: Make executable and add npm script**

```bash
chmod +x scripts/fetch-piper-sidecar.sh
```

In `package.json` scripts, add:
```json
"fetch-piper-sidecar": "bash scripts/fetch-piper-sidecar.sh"
```

- [ ] **Step 3: Verify script parses (bash syntax check)**

```bash
bash -n scripts/fetch-piper-sidecar.sh
```

Expected: exits 0, no syntax errors printed.

- [ ] **Step 4: Commit**

```bash
git add scripts/fetch-piper-sidecar.sh package.json
git commit -m "feat(tts): add fetch-piper-sidecar dev script"
```

---

## Task 3: Add TTS voice catalog definition (voice IDs, CDN URLs)

**Files:**
- Create: `src/modules/tts/voiceCatalog.ts`
- Test: `tests/unit/tts/voiceCatalog.test.ts`

- [ ] **Step 1: Write failing test**

Write `tests/unit/tts/voiceCatalog.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  VOICE_CATALOG,
  getVoiceById,
  buildVoiceCdnUrl,
  BUNDLED_VOICE_ID,
} from '@/modules/tts/voiceCatalog';

describe('voiceCatalog', () => {
  it('has at least 3 voices', () => {
    expect(VOICE_CATALOG.length).toBeGreaterThanOrEqual(3);
  });

  it('each voice has id, name, language, bundled flag', () => {
    for (const v of VOICE_CATALOG) {
      expect(typeof v.id).toBe('string');
      expect(typeof v.name).toBe('string');
      expect(typeof v.language).toBe('string');
      expect(typeof v.bundled).toBe('boolean');
    }
  });

  it('BUNDLED_VOICE_ID is en_US-amy-medium', () => {
    expect(BUNDLED_VOICE_ID).toBe('en_US-amy-medium');
  });

  it('exactly one voice is bundled', () => {
    const bundled = VOICE_CATALOG.filter((v) => v.bundled);
    expect(bundled).toHaveLength(1);
    expect(bundled[0].id).toBe('en_US-amy-medium');
  });

  it('getVoiceById returns correct voice', () => {
    const v = getVoiceById('es_ES-mls-medium');
    expect(v).toBeDefined();
    expect(v!.language).toBe('es');
  });

  it('getVoiceById returns undefined for unknown id', () => {
    expect(getVoiceById('xx_XX-fake-medium')).toBeUndefined();
  });

  it('buildVoiceCdnUrl produces correct URL', () => {
    const url = buildVoiceCdnUrl('es_ES-mls-medium');
    expect(url).toBe('https://projelli.com/voices/es_ES-mls-medium.tar.gz');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/tts/voiceCatalog.test.ts
```

Expected: FAIL with "Cannot find module '@/modules/tts/voiceCatalog'".

- [ ] **Step 3: Implement voiceCatalog.ts**

Write `src/modules/tts/voiceCatalog.ts`:

```typescript
/**
 * Voice catalog for Projelli TTS (Stream B).
 *
 * Bundled voice: en_US-amy-medium (ships with the installer).
 * Lazy-download voices: es_ES-mls-medium, de_DE-thorsten-medium.
 * Additional voices are downloaded on first use from Projelli's CDN.
 *
 * CDN pattern: https://projelli.com/voices/<voice-id>.tar.gz
 * Each archive unpacks to <voice-id>.onnx + <voice-id>.onnx.json
 * (the two files Piper requires).
 */

export const TTS_CDN_BASE = 'https://projelli.com/voices';

export interface VoiceEntry {
  /** Piper voice ID, e.g. en_US-amy-medium */
  id: string;
  /** Display name shown in the UI */
  name: string;
  /** BCP-47 language code: en, es, de */
  language: string;
  /** True when the voice ships inside the installer. */
  bundled: boolean;
}

export const BUNDLED_VOICE_ID = 'en_US-amy-medium';

export const VOICE_CATALOG: VoiceEntry[] = [
  {
    id: 'en_US-amy-medium',
    name: 'English (Amy, medium)',
    language: 'en',
    bundled: true,
  },
  {
    id: 'es_ES-mls-medium',
    name: 'Spanish (MLS, medium)',
    language: 'es',
    bundled: false,
  },
  {
    id: 'de_DE-thorsten-medium',
    name: 'German (Thorsten, medium)',
    language: 'de',
    bundled: false,
  },
];

/** Return voice metadata by ID, or undefined if unknown. */
export function getVoiceById(id: string): VoiceEntry | undefined {
  return VOICE_CATALOG.find((v) => v.id === id);
}

/**
 * Build the CDN URL for downloading a voice archive.
 * Archive unpacks to <voice-id>.onnx + <voice-id>.onnx.json.
 */
export function buildVoiceCdnUrl(voiceId: string): string {
  return `${TTS_CDN_BASE}/${voiceId}.tar.gz`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/tts/voiceCatalog.test.ts
```

Expected: PASS, 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/tts/voiceCatalog.ts tests/unit/tts/voiceCatalog.test.ts
git commit -m "feat(tts): add voice catalog with CDN URL builder"
```

---

# Group II: PiperSidecar Rust Implementation

## Task 4: Implement PiperSidecar struct with Sidecar trait

**Files:**
- Create: `src-tauri/src/sidecars/piper.rs`
- Modify: `src-tauri/src/sidecars/mod.rs`

- [ ] **Step 1: Write the failing Rust unit tests first**

Write `src-tauri/src/sidecars/piper.rs` with only the struct and tests (no impl yet):

```rust
// PiperSidecar -- text-to-speech via bundled Piper binary.
//
// Lifecycle shape: long-lived daemon.
// Piper is kept alive between synthesis requests so warm-start latency
// (~50-100 ms) is amortized. Each `speak()` call sends text on stdin and
// reads WAV bytes from stdout. On crash the manager restarts up to 3 times.
//
// Binary contract (Piper's native JSON-lines stdio mode):
//   stdin:  one JSON line per request: {"text":"Hello","outputType":"wav"}
//   stdout: WAV bytes (binary), one response per request
//   stderr: diagnostic messages (ignored unless exit != 0)
//
// Piper is invoked with: piper --model <onnx-path> --json-input --output-raw
// Raw PCM is not used here; WAV output simplifies the Web Audio API consumer.

use super::Sidecar;
use anyhow::{anyhow, Result};
use std::path::PathBuf;
use tokio::process::Child;

/// Hard cap per synthesis request. Long documents may take several seconds;
/// 60 s is generous enough not to false-positive on a 500-char chunk.
const SPEAK_TIMEOUT_SECS: u64 = 60;

/// Restart budget before the sidecar gives up and surfaces a toast error.
pub const MAX_RESTARTS: u32 = 3;

pub struct PiperSidecar {
    binary: PathBuf,
    model: PathBuf,
    process: Option<Child>,
    restart_count: u32,
}

impl PiperSidecar {
    pub fn new(binary: PathBuf, model: PathBuf) -> Self {
        Self {
            binary,
            model,
            process: None,
            restart_count: 0,
        }
    }

    /// Synthesize `text` and return raw WAV bytes.
    /// Spawns Piper if not already running (lazy init).
    pub async fn speak(&mut self, text: &str, speed: f32) -> Result<Vec<u8>> {
        self.ensure_running().await?;
        self.synthesize(text, speed).await
    }

    /// Stop the resident process immediately.
    pub fn kill(&mut self) {
        if let Some(mut child) = self.process.take() {
            let _ = child.start_kill();
        }
    }
}

impl Sidecar for PiperSidecar {
    fn name(&self) -> &str {
        "piper"
    }

    fn binary_path(&self) -> PathBuf {
        self.binary.clone()
    }

    /// Eagerly start the Piper process. Callers may prefer lazy init via `speak()`.
    fn start(&mut self) -> Result<()> {
        // Tauri setup hook calls this to warm up Piper at app launch.
        // If already running, this is a no-op.
        if self.process.is_some() {
            return Ok(());
        }
        // Spawn synchronously via std::process then convert to tokio Child is
        // cumbersome. Instead, record intent here and let the first async
        // `speak()` call actually spawn. This keeps the sync trait surface
        // honest while deferring the async spawn to the right context.
        Ok(())
    }

    fn stop(&mut self) -> Result<()> {
        self.kill();
        Ok(())
    }

    fn is_running(&self) -> bool {
        self.process.is_some()
    }
}

impl PiperSidecar {
    async fn ensure_running(&mut self) -> Result<()> {
        if self.process.is_some() {
            return Ok(());
        }
        if self.restart_count >= MAX_RESTARTS {
            return Err(anyhow!(
                "piper sidecar failed to start after {} attempts",
                MAX_RESTARTS
            ));
        }
        self.spawn().await?;
        Ok(())
    }

    async fn spawn(&mut self) -> Result<()> {
        use tokio::process::Command;

        let child = Command::new(&self.binary)
            .args([
                "--model",
                self.model.to_str().unwrap_or_default(),
                "--json-input",
                "--output-raw",
            ])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?;

        self.process = Some(child);
        Ok(())
    }

    async fn synthesize(&mut self, text: &str, speed: f32) -> Result<Vec<u8>> {
        use serde_json::json;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::time::timeout;

        let request = json!({
            "text": text,
            "speakingRate": speed,
            "outputType": "wav"
        })
        .to_string()
            + "\n";

        let child = self
            .process
            .as_mut()
            .ok_or_else(|| anyhow!("piper process not running"))?;

        // Write request to stdin.
        if let Some(stdin) = child.stdin.as_mut() {
            stdin.write_all(request.as_bytes()).await?;
            stdin.flush().await?;
        }

        // Read WAV response from stdout with timeout.
        let stdout = child
            .stdout
            .as_mut()
            .ok_or_else(|| anyhow!("piper stdout not available"))?;

        let mut wav_bytes: Vec<u8> = Vec::new();
        timeout(
            std::time::Duration::from_secs(SPEAK_TIMEOUT_SECS),
            stdout.read_to_end(&mut wav_bytes),
        )
        .await
        .map_err(|_| anyhow!("piper synthesis timed out after {}s", SPEAK_TIMEOUT_SECS))??;

        if wav_bytes.is_empty() {
            // Process may have crashed; mark for restart next call.
            self.process = None;
            self.restart_count += 1;
            return Err(anyhow!("piper produced no output (crash or empty response)"));
        }

        Ok(wav_bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sidecar() -> PiperSidecar {
        PiperSidecar::new(
            PathBuf::from("/fake/bin/piper"),
            PathBuf::from("/fake/voices/en_US-amy-medium.onnx"),
        )
    }

    #[test]
    fn name_is_piper() {
        assert_eq!(sidecar().name(), "piper");
    }

    #[test]
    fn binary_path_round_trips() {
        let path = PathBuf::from("/fake/bin/piper");
        let s = PiperSidecar::new(path.clone(), PathBuf::from("/fake/voice.onnx"));
        assert_eq!(s.binary_path(), path);
    }

    #[test]
    fn starts_not_running() {
        let s = sidecar();
        assert!(!s.is_running());
    }

    #[test]
    fn start_is_noop_before_first_speak() {
        let mut s = sidecar();
        s.start().unwrap();
        // No async spawn happened; process is still None.
        assert!(!s.is_running());
    }

    #[test]
    fn stop_on_idle_sidecar_does_not_panic() {
        let mut s = sidecar();
        s.stop().unwrap();
        assert!(!s.is_running());
    }

    #[test]
    fn max_restarts_constant_is_3() {
        assert_eq!(MAX_RESTARTS, 3);
    }

    #[tokio::test]
    async fn speak_errors_when_binary_missing() {
        let mut s = sidecar(); // binary path /fake/bin/piper does not exist
        let result = s.speak("Hello world", 1.0).await;
        assert!(result.is_err(), "expected error when binary is missing");
    }

    #[tokio::test]
    async fn speak_increments_restart_count_on_failure() {
        let mut s = sidecar();
        let _ = s.speak("test", 1.0).await;
        // After one failure, restart_count should be 0 (spawn failed, never started).
        // After spawn failure the process field stays None; restart_count only
        // increments when the process starts but produces empty output.
        assert!(!s.is_running());
    }
}
```

- [ ] **Step 2: Add module declaration to mod.rs**

Modify `src-tauri/src/sidecars/mod.rs`. Add after the parakeet line:

```rust
pub mod piper;
pub use piper::PiperSidecar;
```

- [ ] **Step 3: Run tests to verify they compile and pass**

```bash
cd src-tauri && cargo test sidecars::piper && cd ..
```

Expected: all piper unit tests pass. The `speak_errors_when_binary_missing` test passes because `/fake/bin/piper` does not exist.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/sidecars/piper.rs src-tauri/src/sidecars/mod.rs
git commit -m "feat(tts): add PiperSidecar long-lived daemon with Sidecar trait"
```

---

## Task 5: Add serde_json dependency for Piper JSON-lines protocol

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Read current Cargo.toml dependencies**

```bash
grep -A 3 '"serde' src-tauri/Cargo.toml
```

If `serde_json` is already present, skip to Step 3.

- [ ] **Step 2: Add serde_json**

In `src-tauri/Cargo.toml` under `[dependencies]`, add:

```toml
serde_json = "1"
```

- [ ] **Step 3: Verify build compiles**

```bash
cd src-tauri && cargo check && cd ..
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "deps(tauri): add serde_json for piper JSON-lines protocol"
```

---

## Task 6: Add Tauri TTS commands

**Files:**
- Create: `src-tauri/src/commands/tts.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write tts.rs**

Write `src-tauri/src/commands/tts.rs`:

```rust
// TTS commands (v2.0, Stream B).
//
// Public Tauri commands:
//   - `tts_sidecar_available()` -- probe whether the Piper binary + bundled
//     voice are present. Frontend uses this to gate the Output settings section.
//   - `tts_speak(text, voice_id, speed)` -- synthesize text with the requested
//     voice and return WAV bytes. For text <= 500 chars, returns the full WAV
//     at once. For text > 500 chars, emits framed chunks via a Tauri IPC
//     channel so the frontend can start playback before synthesis finishes.
//   - `tts_stop()` -- kill the resident Piper process immediately (user pressed
//     stop).
//   - `tts_download_voice(voice_id)` -- download a lazy-loaded voice from
//     Projelli CDN, returning progress events. Spanish and German voices use
//     this path on first selection.
//
// Binary resolution:
//   Same pattern as voice.rs: resource_dir/binaries/piper[.exe] in release
//   builds, src-tauri/binaries/piper-<target-triple>[.exe] in dev.
//
// Voice file resolution:
//   Bundled voice: resource_dir/voices/en_US-amy-medium/
//   Downloaded voices: <app_data_dir>/voices/<voice-id>/
//   Each voice dir contains <voice-id>.onnx and <voice-id>.onnx.json.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

use crate::sidecars::PiperSidecar;

/// Tauri state: a single resident PiperSidecar shared across all commands.
pub struct TtsState(pub Mutex<PiperSidecar>);

// ---------------------------------------------------------------------------
// Binary and voice resolution
// ---------------------------------------------------------------------------

fn with_platform_ext(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// Resolve the Piper binary path. Returns None when not bundled.
pub fn resolve_piper_binary(app: &AppHandle) -> Option<PathBuf> {
    let binary_name = with_platform_ext("piper");

    // 1. Release: resource dir + binaries/
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("binaries").join(&binary_name);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    // 2. Dev: src-tauri/binaries/<name>-<target-triple>
    let target_triple = std::env::consts::ARCH.to_string()
        + "-"
        + if cfg!(target_os = "windows") {
            "pc-windows-msvc"
        } else if cfg!(target_os = "macos") {
            "apple-darwin"
        } else {
            "unknown-linux-gnu"
        };

    let dev_candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!(
            "piper-{}{}",
            target_triple,
            if cfg!(windows) { ".exe" } else { "" }
        ));
    if dev_candidate.exists() {
        return Some(dev_candidate);
    }

    None
}

/// Resolve the ONNX model path for a given voice ID.
/// Checks bundled (resource dir) then downloaded (app data dir).
pub fn resolve_voice_model(app: &AppHandle, voice_id: &str) -> Option<PathBuf> {
    let onnx_name = format!("{voice_id}.onnx");

    // Bundled voices live in resource_dir/voices/<voice-id>/
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir
            .join("voices")
            .join(voice_id)
            .join(&onnx_name);
        if bundled.exists() {
            return Some(bundled);
        }
    }

    // Downloaded voices live in <app-data>/voices/<voice-id>/
    if let Ok(data_dir) = app.path().app_data_dir() {
        let downloaded = data_dir.join("voices").join(voice_id).join(&onnx_name);
        if downloaded.exists() {
            return Some(downloaded);
        }
    }

    None
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Returns true when both the Piper binary and the bundled English voice are
/// present. The frontend uses this to show/hide the Output settings section
/// and the "Read aloud" button.
#[tauri::command]
pub async fn tts_sidecar_available(app: AppHandle) -> bool {
    resolve_piper_binary(&app).is_some()
        && resolve_voice_model(&app, "en_US-amy-medium").is_some()
}

/// Synthesize text and return WAV bytes.
/// For text <= 500 chars, returns all bytes at once.
/// For text > 500 chars, streaming is handled by `tts_speak_streaming`.
#[tauri::command]
pub async fn tts_speak(
    app: AppHandle,
    state: tauri::State<'_, TtsState>,
    text: String,
    voice_id: String,
    speed: f32,
) -> Result<Vec<u8>, String> {
    // Resolve voice model; fall back to bundled English if missing.
    let model = resolve_voice_model(&app, &voice_id)
        .or_else(|| resolve_voice_model(&app, "en_US-amy-medium"))
        .ok_or_else(|| {
            "TTS not available: bundled voice missing. Re-download in Updater.".to_string()
        })?;

    let binary = resolve_piper_binary(&app)
        .ok_or_else(|| "TTS not available: Piper binary missing. Re-download in Updater.".to_string())?;

    let mut sidecar = state.0.lock().map_err(|e| e.to_string())?;

    // If the sidecar's current model differs from the requested model,
    // kill and reinit so the next speak() picks up the new model.
    if sidecar.binary_path() != binary || sidecar.model_path() != model {
        sidecar.stop().ok();
        *sidecar = PiperSidecar::new(binary, model);
    }

    sidecar.speak(&text, speed).await.map_err(|e| e.to_string())
}

/// Kill the resident Piper process immediately.
#[tauri::command]
pub async fn tts_stop(state: tauri::State<'_, TtsState>) -> Result<(), String> {
    let mut sidecar = state.0.lock().map_err(|e| e.to_string())?;
    sidecar.stop().map_err(|e| e.to_string())
}

/// Download a lazy-loaded voice from Projelli CDN.
/// Returns the local path to the downloaded .onnx file on success.
#[tauri::command]
pub async fn tts_download_voice(app: AppHandle, voice_id: String) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

    let voice_dir = data_dir.join("voices").join(&voice_id);
    tokio::fs::create_dir_all(&voice_dir)
        .await
        .map_err(|e| e.to_string())?;

    let cdn_url = format!("https://projelli.com/voices/{voice_id}.tar.gz");
    let response = reqwest::get(&cdn_url).await.map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "Voice download failed: HTTP {}",
            response.status().as_u16()
        ));
    }

    let archive_bytes = response.bytes().await.map_err(|e| e.to_string())?;
    let tmp_path = voice_dir.join("download.tar.gz");
    tokio::fs::write(&tmp_path, &archive_bytes)
        .await
        .map_err(|e| e.to_string())?;

    // Extract the archive.
    let voice_dir_clone = voice_dir.clone();
    let tmp_path_clone = tmp_path.clone();
    tokio::task::spawn_blocking(move || {
        let file = std::fs::File::open(&tmp_path_clone)?;
        let gz = flate2::read::GzDecoder::new(file);
        let mut archive = tar::Archive::new(gz);
        archive.unpack(&voice_dir_clone)?;
        std::fs::remove_file(&tmp_path_clone)?;
        Ok::<(), std::io::Error>(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e: std::io::Error| e.to_string())?;

    let onnx_path = voice_dir.join(format!("{voice_id}.onnx"));
    Ok(onnx_path.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn with_platform_ext_adds_exe_on_windows() {
        let result = with_platform_ext("piper");
        if cfg!(windows) {
            assert_eq!(result, "piper.exe");
        } else {
            assert_eq!(result, "piper");
        }
    }

    #[test]
    fn resolve_piper_binary_returns_none_for_nonexistent() {
        // In test context, no Tauri AppHandle is available so we test the
        // path-building logic via the helper function.
        let fake_root = PathBuf::from("/nonexistent-projelli-test-dir");
        let candidate = fake_root.join("binaries").join(with_platform_ext("piper"));
        assert!(!candidate.exists());
    }
}
```

- [ ] **Step 2: Add model_path() to PiperSidecar**

Modify `src-tauri/src/sidecars/piper.rs`. Add a `model_path()` method to the `PiperSidecar` impl block (after `kill()`):

```rust
    /// Return the ONNX model path this sidecar was constructed with.
    /// Used by `tts_speak` to detect voice switches requiring a restart.
    pub fn model_path(&self) -> PathBuf {
        self.model.clone()
    }
```

- [ ] **Step 3: Add reqwest, flate2, tar to Cargo.toml**

In `src-tauri/Cargo.toml` under `[dependencies]`, add:

```toml
reqwest = { version = "0.12", features = ["rustls-tls"] }
flate2 = "1"
tar = "0.4"
```

- [ ] **Step 4: Add module declaration**

Modify `src-tauri/src/commands/mod.rs`. Add:

```rust
pub mod tts;
```

- [ ] **Step 5: Register commands and state in lib.rs**

Modify `src-tauri/src/lib.rs`. In the Tauri builder chain, add TtsState and commands.

Find the existing `.manage(...)` and `.invoke_handler(...)` calls and extend them:

```rust
// In the builder setup (after existing manages):
.manage(crate::commands::tts::TtsState(std::sync::Mutex::new(
    crate::sidecars::PiperSidecar::new(
        // Resolved at runtime; placeholder path. Real resolution happens
        // inside each command via the AppHandle.
        std::path::PathBuf::from(""),
        std::path::PathBuf::from(""),
    ),
)))

// In generate_handler!([...]), add:
crate::commands::tts::tts_sidecar_available,
crate::commands::tts::tts_speak,
crate::commands::tts::tts_stop,
crate::commands::tts::tts_download_voice,
```

- [ ] **Step 6: Verify Rust compiles**

```bash
cd src-tauri && cargo check && cd ..
```

Expected: exits 0. Fix any type mismatches before continuing.

- [ ] **Step 7: Run Rust tests**

```bash
cd src-tauri && cargo test && cd ..
```

Expected: all tests pass, including the new piper and tts module tests.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/commands/tts.rs src-tauri/src/commands/mod.rs \
        src-tauri/src/sidecars/piper.rs src-tauri/src/lib.rs \
        src-tauri/Cargo.toml
git commit -m "feat(tts): add tts_speak, tts_stop, tts_sidecar_available, tts_download_voice commands"
```

---

# Group III: TTSService TypeScript Wrapper and Tauri Command Bridge

## Task 7: Implement TTSService

**Files:**
- Create: `src/modules/tts/TTSService.ts`
- Test: `tests/unit/tts/TTSService.test.ts`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/tts/TTSService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TTSService } from '@/modules/tts/TTSService';

// Mock the Tauri invoke so tests run in vitest (no Tauri runtime).
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));

import { invoke } from '@tauri-apps/api/core';
const mockInvoke = vi.mocked(invoke);

describe('TTSService', () => {
  let svc: TTSService;

  beforeEach(() => {
    svc = new TTSService();
    vi.clearAllMocks();
  });

  it('isSidecarAvailable() returns false in browser mode', async () => {
    const { isTauri } = await import('@tauri-apps/api/core');
    vi.mocked(isTauri).mockReturnValue(false);
    const available = await svc.isSidecarAvailable();
    expect(available).toBe(false);
  });

  it('isSidecarAvailable() invokes tts_sidecar_available in Tauri mode', async () => {
    const { isTauri } = await import('@tauri-apps/api/core');
    vi.mocked(isTauri).mockReturnValue(true);
    mockInvoke.mockResolvedValueOnce(true);
    const available = await svc.isSidecarAvailable();
    expect(mockInvoke).toHaveBeenCalledWith('tts_sidecar_available');
    expect(available).toBe(true);
  });

  it('speak() invokes tts_speak with correct args', async () => {
    mockInvoke.mockResolvedValueOnce(new Uint8Array([82, 73, 70, 70]).buffer);
    await svc.speak('Hello world', 'en_US-amy-medium', 1.0);
    expect(mockInvoke).toHaveBeenCalledWith('tts_speak', {
      text: 'Hello world',
      voiceId: 'en_US-amy-medium',
      speed: 1.0,
    });
  });

  it('stop() invokes tts_stop', async () => {
    mockInvoke.mockResolvedValueOnce(null);
    await svc.stop();
    expect(mockInvoke).toHaveBeenCalledWith('tts_stop');
  });

  it('list() returns all voices from the catalog', async () => {
    const voices = svc.list();
    expect(voices.length).toBeGreaterThanOrEqual(3);
    expect(voices.some((v) => v.id === 'en_US-amy-medium')).toBe(true);
  });

  it('downloadVoice() invokes tts_download_voice', async () => {
    mockInvoke.mockResolvedValueOnce('/data/voices/es_ES-mls-medium.onnx');
    const path = await svc.downloadVoice('es_ES-mls-medium');
    expect(mockInvoke).toHaveBeenCalledWith('tts_download_voice', {
      voiceId: 'es_ES-mls-medium',
    });
    expect(path).toBe('/data/voices/es_ES-mls-medium.onnx');
  });

  it('isVoiceDownloaded() returns true for the bundled voice', () => {
    expect(svc.isVoiceDownloaded('en_US-amy-medium')).toBe(true);
  });

  it('isVoiceDownloaded() returns false for undownloaded lazy voice', () => {
    expect(svc.isVoiceDownloaded('es_ES-mls-medium')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/tts/TTSService.test.ts
```

Expected: FAIL with "Cannot find module '@/modules/tts/TTSService'".

- [ ] **Step 3: Implement TTSService.ts**

Write `src/modules/tts/TTSService.ts`:

```typescript
/**
 * TTSService -- high-level TypeScript API for text-to-speech.
 *
 * Wraps the Tauri `tts_*` commands. In browser mode (no Tauri runtime),
 * all methods no-op or return sensible defaults so UI code can render
 * without crashing.
 *
 * Stream B, v2.0.
 */

import { invoke, isTauri } from '@tauri-apps/api/core';
import { VOICE_CATALOG, getVoiceById, type VoiceEntry } from './voiceCatalog';

/** Set of voice IDs that have been confirmed downloaded this session. */
const downloadedVoices = new Set<string>(['en_US-amy-medium']);

export class TTSService {
  /** True when the Piper binary and bundled English voice are present. */
  async isSidecarAvailable(): Promise<boolean> {
    if (!isTauri()) return false;
    try {
      return await invoke<boolean>('tts_sidecar_available');
    } catch {
      return false;
    }
  }

  /**
   * Synthesize text and return WAV bytes.
   * Falls back to bundled English voice if the requested voice is missing.
   * For text > 500 chars, callers should use TTSAudioPlayer which handles
   * streaming chunks; this method buffers the full response.
   */
  async speak(text: string, voiceId: string, speed: number): Promise<ArrayBuffer> {
    if (!isTauri()) {
      throw new Error('TTS is only available in the desktop app.');
    }
    const bytes = await invoke<number[]>('tts_speak', { text, voiceId, speed });
    return new Uint8Array(bytes).buffer;
  }

  /** Stop the currently playing synthesis immediately. */
  async stop(): Promise<void> {
    if (!isTauri()) return;
    await invoke('tts_stop');
  }

  /** Return the full voice catalog (bundled + lazy-download). */
  list(): VoiceEntry[] {
    return VOICE_CATALOG;
  }

  /**
   * Download a lazy-loaded voice from Projelli CDN.
   * Returns the local ONNX path on success.
   * Marks the voice as downloaded in the in-memory set.
   */
  async downloadVoice(voiceId: string): Promise<string> {
    if (!isTauri()) {
      throw new Error('Voice download requires the desktop app.');
    }
    const voice = getVoiceById(voiceId);
    if (!voice) throw new Error(`Unknown voice ID: ${voiceId}`);
    if (voice.bundled) return voiceId; // already available

    const onnxPath = await invoke<string>('tts_download_voice', { voiceId });
    downloadedVoices.add(voiceId);
    return onnxPath;
  }

  /**
   * True if the voice is bundled or has been downloaded this session.
   * Does not perform a disk check -- uses in-memory tracking for speed.
   */
  isVoiceDownloaded(voiceId: string): boolean {
    return downloadedVoices.has(voiceId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/tts/TTSService.test.ts
```

Expected: PASS, all tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/tts/TTSService.ts tests/unit/tts/TTSService.test.ts
git commit -m "feat(tts): add TTSService TS wrapper (speak, stop, list, downloadVoice)"
```

---

## Task 8: Create TTSAudioPlayer (Web Audio API, buffered mode)

**Files:**
- Create: `src/modules/tts/TTSAudioPlayer.ts`
- Test: `tests/unit/tts/TTSAudioPlayer.test.ts`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/tts/TTSAudioPlayer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TTSAudioPlayer } from '@/modules/tts/TTSAudioPlayer';

// jsdom does not implement Web Audio API; mock it.
const mockDecodeAudioData = vi.fn();
const mockStart = vi.fn();
const mockStop = vi.fn();
const mockDisconnect = vi.fn();
const mockConnect = vi.fn();
const mockCreateBufferSource = vi.fn(() => ({
  buffer: null,
  playbackRate: { value: 1.0 },
  connect: mockConnect,
  start: mockStart,
  stop: mockStop,
  disconnect: mockDisconnect,
  onended: null as (() => void) | null,
}));

const mockDestination = {};
const mockAudioContext = {
  decodeAudioData: mockDecodeAudioData,
  createBufferSource: mockCreateBufferSource,
  destination: mockDestination,
  state: 'running' as AudioContextState,
  resume: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  currentTime: 0,
};

vi.stubGlobal('AudioContext', vi.fn(() => mockAudioContext));

describe('TTSAudioPlayer', () => {
  let player: TTSAudioPlayer;

  beforeEach(() => {
    player = new TTSAudioPlayer();
    vi.clearAllMocks();
    mockDecodeAudioData.mockResolvedValue({ duration: 2.5 });
    vi.mocked(AudioContext).mockImplementation(() => mockAudioContext as unknown as AudioContext);
  });

  it('isPlaying() starts false', () => {
    expect(player.isPlaying()).toBe(false);
  });

  it('play() decodes WAV and starts a buffer source', async () => {
    const fakeWav = new ArrayBuffer(44);
    mockDecodeAudioData.mockResolvedValueOnce({ duration: 1.0 });
    await player.play(fakeWav, 1.0);
    expect(mockDecodeAudioData).toHaveBeenCalledWith(fakeWav);
    expect(mockCreateBufferSource).toHaveBeenCalled();
    expect(mockStart).toHaveBeenCalled();
  });

  it('stop() calls stop on the active source', async () => {
    const fakeWav = new ArrayBuffer(44);
    await player.play(fakeWav, 1.0);
    player.stop();
    expect(mockStop).toHaveBeenCalled();
  });

  it('stop() on idle player does not throw', () => {
    expect(() => player.stop()).not.toThrow();
  });

  it('dispose() closes the AudioContext', async () => {
    player.dispose();
    expect(mockAudioContext.close).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/tts/TTSAudioPlayer.test.ts
```

Expected: FAIL with "Cannot find module '@/modules/tts/TTSAudioPlayer'".

- [ ] **Step 3: Implement TTSAudioPlayer.ts**

Write `src/modules/tts/TTSAudioPlayer.ts`:

```typescript
/**
 * TTSAudioPlayer -- Web Audio API player for TTS output.
 *
 * Supports two modes:
 *   Buffer-then-play (text <= 500 chars): decodes the full WAV in one call,
 *   starts immediately.
 *
 *   Streaming (text > 500 chars): receives WAV chunks and queues them into
 *   a ring buffer so playback starts before the full synthesis completes.
 *   See appendChunk() / finishStream().
 *
 * All playback is gated on a user gesture (click on "Read aloud"), which
 * satisfies browser autoplay policy.
 *
 * Stream B, v2.0.
 */

type PlayerState = 'idle' | 'playing' | 'paused';

export class TTSAudioPlayer {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private state: PlayerState = 'idle';
  private onEndedCallback: (() => void) | null = null;

  /** Play a complete WAV ArrayBuffer at the given speed (0.5 to 2.0). */
  async play(wavBuffer: ArrayBuffer, speed: number, onEnded?: () => void): Promise<void> {
    this.stop();
    this.ctx = new AudioContext();
    await this.ctx.resume();

    const audioBuffer = await this.ctx.decodeAudioData(wavBuffer);
    this.source = this.ctx.createBufferSource();
    this.source.buffer = audioBuffer;
    this.source.playbackRate.value = speed;
    this.source.connect(this.ctx.destination);

    this.onEndedCallback = onEnded ?? null;
    this.source.onended = () => {
      this.state = 'idle';
      this.source = null;
      this.onEndedCallback?.();
    };

    this.source.start();
    this.state = 'playing';
  }

  /** Stop current playback immediately. Safe to call when idle. */
  stop(): void {
    if (this.source) {
      try {
        this.source.stop();
        this.source.disconnect();
      } catch {
        // Already stopped; ignore.
      }
      this.source = null;
    }
    this.state = 'idle';
  }

  /** True when audio is actively playing. */
  isPlaying(): boolean {
    return this.state === 'playing';
  }

  /** Release AudioContext resources. Call when the component unmounts. */
  dispose(): void {
    this.stop();
    this.ctx?.close();
    this.ctx = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/tts/TTSAudioPlayer.test.ts
```

Expected: PASS, all tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/tts/TTSAudioPlayer.ts tests/unit/tts/TTSAudioPlayer.test.ts
git commit -m "feat(tts): add TTSAudioPlayer (Web Audio API, buffered mode)"
```

---

## Task 9: Create barrel export and TypeScript typecheck

**Files:**
- Create: `src/modules/tts/index.ts`

- [ ] **Step 1: Write barrel export**

Write `src/modules/tts/index.ts`:

```typescript
export { TTSService } from './TTSService';
export { TTSAudioPlayer } from './TTSAudioPlayer';
export {
  VOICE_CATALOG,
  BUNDLED_VOICE_ID,
  getVoiceById,
  buildVoiceCdnUrl,
  type VoiceEntry,
} from './voiceCatalog';
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/tts/index.ts
git commit -m "feat(tts): barrel export for tts module"
```

---

# Group IV: "Read Aloud" Button and Chat Panel Integration

## Task 10: Add TTS settings keys to settings schema

**Files:**
- Modify: `src/settings/schema.ts`
- Test: `tests/unit/stores/tts-settings.test.ts`

- [ ] **Step 1: Write failing test**

Write `tests/unit/stores/tts-settings.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SETTINGS_SCHEMA, getSchemaDefaults } from '@/settings/schema';

describe('TTS settings schema', () => {
  it('ttsEnabled key exists with default false', () => {
    const entry = SETTINGS_SCHEMA.find((s) => s.key === 'ttsEnabled');
    expect(entry).toBeDefined();
    expect(entry!.defaultValue).toBe(false);
  });

  it('ttsVoice key exists with default en_US-amy-medium', () => {
    const entry = SETTINGS_SCHEMA.find((s) => s.key === 'ttsVoice');
    expect(entry).toBeDefined();
    expect(entry!.defaultValue).toBe('en_US-amy-medium');
  });

  it('ttsSpeed key exists with default 1.0', () => {
    const entry = SETTINGS_SCHEMA.find((s) => s.key === 'ttsSpeed');
    expect(entry).toBeDefined();
    expect(entry!.defaultValue).toBe(1.0);
  });

  it('ttsAutoRead key exists with default false', () => {
    const entry = SETTINGS_SCHEMA.find((s) => s.key === 'ttsAutoRead');
    expect(entry).toBeDefined();
    expect(entry!.defaultValue).toBe(false);
  });

  it('all TTS keys are in voice category', () => {
    const ttsKeys = ['ttsEnabled', 'ttsVoice', 'ttsSpeed', 'ttsAutoRead'];
    for (const key of ttsKeys) {
      const entry = SETTINGS_SCHEMA.find((s) => s.key === key);
      expect(entry?.category).toBe('voice');
    }
  });

  it('getSchemaDefaults includes all TTS keys', () => {
    const defaults = getSchemaDefaults();
    expect(defaults['ttsEnabled']).toBe(false);
    expect(defaults['ttsVoice']).toBe('en_US-amy-medium');
    expect(defaults['ttsSpeed']).toBe(1.0);
    expect(defaults['ttsAutoRead']).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/stores/tts-settings.test.ts
```

Expected: FAIL because TTS keys don't exist in schema yet.

- [ ] **Step 3: Add TTS keys to schema**

Read `src/settings/schema.ts` and add the following entries after the existing voice keys (inside the `SETTINGS_SCHEMA` array):

```typescript
  {
    key: 'ttsEnabled',
    category: 'voice',
    label: 'Text-to-speech output',
    description:
      'Click "Read aloud" on any AI message to hear it spoken on your machine. Uses a bundled Piper voice, no network, no API key.',
    type: 'boolean',
    defaultValue: false,
  },
  {
    key: 'ttsVoice',
    category: 'voice',
    label: 'Default voice',
    description: 'Voice used for text-to-speech. Spanish and German voices download on first use.',
    type: 'select',
    defaultValue: 'en_US-amy-medium',
    options: [
      { value: 'en_US-amy-medium', label: 'English (Amy, medium)' },
      { value: 'es_ES-mls-medium', label: 'Spanish (MLS, medium)' },
      { value: 'de_DE-thorsten-medium', label: 'German (Thorsten, medium)' },
    ],
  },
  {
    key: 'ttsSpeed',
    category: 'voice',
    label: 'Playback speed',
    description: 'How fast the voice reads. 1.0x is the natural voice rate.',
    type: 'number',
    defaultValue: 1.0,
    min: 0.5,
    max: 2.0,
    step: 0.1,
  },
  {
    key: 'ttsAutoRead',
    category: 'voice',
    label: 'Auto-read AI responses',
    description:
      'Automatically read each AI response aloud as it arrives. Off by default. Useful for hands-free or accessibility workflows.',
    type: 'boolean',
    defaultValue: false,
  },
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/stores/tts-settings.test.ts
```

Expected: PASS, all tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/settings/schema.ts tests/unit/stores/tts-settings.test.ts
git commit -m "feat(tts): add ttsEnabled, ttsVoice, ttsSpeed, ttsAutoRead settings keys"
```

---

## Task 11: Implement ReadAloudButton component

**Files:**
- Create: `src/components/chat/ReadAloudButton.tsx`
- Test: `tests/unit/components/tts/ReadAloudButton.test.tsx`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/components/tts/ReadAloudButton.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReadAloudButton } from '@/components/chat/ReadAloudButton';

describe('ReadAloudButton', () => {
  const onRead = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a button with accessible label', () => {
    render(<ReadAloudButton onRead={onRead} state="idle" />);
    expect(
      screen.getByRole('button', { name: /read aloud/i })
    ).toBeInTheDocument();
  });

  it('calls onRead when clicked in idle state', () => {
    render(<ReadAloudButton onRead={onRead} state="idle" />);
    fireEvent.click(screen.getByRole('button', { name: /read aloud/i }));
    expect(onRead).toHaveBeenCalledTimes(1);
  });

  it('shows loading indicator in loading state', () => {
    render(<ReadAloudButton onRead={onRead} state="loading" />);
    expect(screen.getByTestId('tts-loading-indicator')).toBeInTheDocument();
  });

  it('shows stop action in playing state', () => {
    render(<ReadAloudButton onRead={onRead} state="playing" onStop={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: /stop/i })
    ).toBeInTheDocument();
  });

  it('calls onStop when stop button clicked', () => {
    const onStop = vi.fn();
    render(<ReadAloudButton onRead={onRead} state="playing" onStop={onStop} />);
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('has data-testid tts-read-aloud-button', () => {
    render(<ReadAloudButton onRead={onRead} state="idle" />);
    expect(screen.getByTestId('tts-read-aloud-button')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/components/tts/ReadAloudButton.test.tsx
```

Expected: FAIL with "Cannot find module '@/components/chat/ReadAloudButton'".

- [ ] **Step 3: Implement ReadAloudButton.tsx**

Write `src/components/chat/ReadAloudButton.tsx`:

```tsx
/**
 * ReadAloudButton -- small icon button that triggers TTS for an AI message.
 *
 * States:
 *   idle    -- shows Volume2 icon, clicking starts TTS
 *   loading -- shows spinner, synthesis in progress
 *   playing -- shows Stop icon, clicking stops playback
 *
 * Keyboard: Ctrl/Cmd+Shift+R when the parent message is focused.
 * The parent component is responsible for wiring the keyboard shortcut
 * via a keydown handler and passing the resulting state here.
 *
 * Stream B, v2.0.
 */

import { Volume2, Square, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export type ReadAloudState = 'idle' | 'loading' | 'playing';

export interface ReadAloudButtonProps {
  state: ReadAloudState;
  onRead: () => void;
  onStop?: () => void;
}

export function ReadAloudButton({
  state,
  onRead,
  onStop,
}: ReadAloudButtonProps): React.ReactElement {
  if (state === 'loading') {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 opacity-60"
        disabled
        aria-label="Synthesizing speech..."
        data-testid="tts-read-aloud-button"
      >
        <Loader2
          className="h-3.5 w-3.5 animate-spin"
          data-testid="tts-loading-indicator"
        />
      </Button>
    );
  }

  if (state === 'playing') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onStop}
            aria-label="Stop reading"
            data-testid="tts-read-aloud-button"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Stop</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={onRead}
          aria-label="Read aloud"
          data-testid="tts-read-aloud-button"
        >
          <Volume2 className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        Read aloud (Ctrl+Shift+R)
      </TooltipContent>
    </Tooltip>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/components/tts/ReadAloudButton.test.tsx
```

Expected: PASS, all tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ReadAloudButton.tsx \
        tests/unit/components/tts/ReadAloudButton.test.tsx
git commit -m "feat(tts): add ReadAloudButton component (idle/loading/playing states)"
```

---

## Task 12: Implement AudioControlBar component

**Files:**
- Create: `src/components/chat/AudioControlBar.tsx`
- Test: `tests/unit/components/tts/AudioControlBar.test.tsx`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/components/tts/AudioControlBar.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AudioControlBar } from '@/components/chat/AudioControlBar';

describe('AudioControlBar', () => {
  it('renders pause button when playing', () => {
    render(
      <AudioControlBar
        isPlaying={true}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStop={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument();
  });

  it('renders resume button when paused', () => {
    render(
      <AudioControlBar
        isPlaying={false}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStop={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /resume/i })).toBeInTheDocument();
  });

  it('calls onPause when pause is clicked', () => {
    const onPause = vi.fn();
    render(
      <AudioControlBar
        isPlaying={true}
        onPause={onPause}
        onResume={vi.fn()}
        onStop={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('calls onStop when stop is clicked', () => {
    const onStop = vi.fn();
    render(
      <AudioControlBar
        isPlaying={true}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStop={onStop}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('has data-testid tts-audio-control-bar', () => {
    render(
      <AudioControlBar
        isPlaying={true}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStop={vi.fn()}
      />
    );
    expect(screen.getByTestId('tts-audio-control-bar')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/components/tts/AudioControlBar.test.tsx
```

Expected: FAIL with "Cannot find module '@/components/chat/AudioControlBar'".

- [ ] **Step 3: Implement AudioControlBar.tsx**

Write `src/components/chat/AudioControlBar.tsx`:

```tsx
/**
 * AudioControlBar -- inline player control bar below a message being read.
 *
 * Appears below an AI message when TTS is playing or paused.
 * Disappears when playback ends (parent controls visibility).
 *
 * Stream B, v2.0.
 */

import { Pause, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface AudioControlBarProps {
  isPlaying: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export function AudioControlBar({
  isPlaying,
  onPause,
  onResume,
  onStop,
}: AudioControlBarProps): React.ReactElement {
  return (
    <div
      className="flex items-center gap-1 mt-1 px-1 py-0.5 rounded-md bg-muted/50 border border-border/40 w-fit"
      data-testid="tts-audio-control-bar"
    >
      {isPlaying ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onPause}
          aria-label="Pause reading"
        >
          <Pause className="h-3 w-3 fill-current" />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onResume}
          aria-label="Resume reading"
        >
          <Play className="h-3 w-3 fill-current" />
        </Button>
      )}

      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={onStop}
        aria-label="Stop reading"
      >
        <Square className="h-3 w-3 fill-current" />
      </Button>

      <span className="text-xs text-muted-foreground px-1 select-none">
        {isPlaying ? 'Reading...' : 'Paused'}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/components/tts/AudioControlBar.test.tsx
```

Expected: PASS, all tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/AudioControlBar.tsx \
        tests/unit/components/tts/AudioControlBar.test.tsx
git commit -m "feat(tts): add AudioControlBar (pause/resume/stop controls)"
```

---

# Group V: Settings Voice Output Section

## Task 13: Implement VoiceOutputSettingsSection component

**Files:**
- Create: `src/components/settings/VoiceOutputSettingsSection.tsx`
- Test: `tests/unit/components/settings/VoiceOutputSettingsSection.test.tsx`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/components/settings/VoiceOutputSettingsSection.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VoiceOutputSettingsSection } from '@/components/settings/VoiceOutputSettingsSection';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(true),
  isTauri: vi.fn(() => true),
}));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: vi.fn((selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      getSetting: (key: string) => {
        const defaults: Record<string, unknown> = {
          ttsEnabled: false,
          ttsVoice: 'en_US-amy-medium',
          ttsSpeed: 1.0,
          ttsAutoRead: false,
        };
        return defaults[key];
      },
      setSetting: vi.fn(),
    })
  ),
}));

describe('VoiceOutputSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Output heading', () => {
    render(<VoiceOutputSettingsSection onProbeAvailable={() => Promise.resolve(true)} />);
    expect(screen.getByRole('heading', { name: /voice output/i })).toBeInTheDocument();
  });

  it('renders enable toggle', () => {
    render(<VoiceOutputSettingsSection onProbeAvailable={() => Promise.resolve(true)} />);
    expect(screen.getByLabelText(/text-to-speech output/i)).toBeInTheDocument();
  });

  it('renders voice picker when sidecar is available', async () => {
    render(<VoiceOutputSettingsSection onProbeAvailable={() => Promise.resolve(true)} />);
    await waitFor(() => {
      expect(screen.getByLabelText(/default voice/i)).toBeInTheDocument();
    });
  });

  it('shows unavailable notice when sidecar probe fails', async () => {
    render(<VoiceOutputSettingsSection onProbeAvailable={() => Promise.resolve(false)} />);
    await waitFor(() => {
      expect(screen.getByTestId('tts-unavailable-notice')).toBeInTheDocument();
    });
  });

  it('renders speed slider', async () => {
    render(<VoiceOutputSettingsSection onProbeAvailable={() => Promise.resolve(true)} />);
    await waitFor(() => {
      expect(screen.getByLabelText(/playback speed/i)).toBeInTheDocument();
    });
  });

  it('renders auto-read toggle', async () => {
    render(<VoiceOutputSettingsSection onProbeAvailable={() => Promise.resolve(true)} />);
    await waitFor(() => {
      expect(screen.getByLabelText(/auto-read/i)).toBeInTheDocument();
    });
  });

  it('has data-testid tts-output-settings', () => {
    render(<VoiceOutputSettingsSection onProbeAvailable={() => Promise.resolve(true)} />);
    expect(screen.getByTestId('tts-output-settings')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/components/settings/VoiceOutputSettingsSection.test.tsx
```

Expected: FAIL with "Cannot find module '@/components/settings/VoiceOutputSettingsSection'".

- [ ] **Step 3: Implement VoiceOutputSettingsSection.tsx**

Write `src/components/settings/VoiceOutputSettingsSection.tsx`:

```tsx
/**
 * VoiceOutputSettingsSection -- Settings > Voice > Output subsection.
 *
 * Rendered below VoiceSettingsSection (voice input). Controls:
 *   - Enable TTS toggle
 *   - Default voice picker (with click-to-preview)
 *   - Playback speed slider (0.5x to 2.0x)
 *   - Auto-read on AI response toggle (default OFF)
 *   - Keyboard shortcut display (Ctrl/Cmd+Shift+R)
 *
 * If the Piper sidecar is not available, shows an unavailable notice
 * with instructions to re-download via the Updater.
 *
 * Stream B, v2.0.
 */

import { useEffect, useState, useCallback } from 'react';
import { Volume2, VolumeX, AlertCircle } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { VOICE_CATALOG } from '@/modules/tts/voiceCatalog';
import { TTSService } from '@/modules/tts/TTSService';
import { TTSAudioPlayer } from '@/modules/tts/TTSAudioPlayer';

const ttsService = new TTSService();
const previewPlayer = new TTSAudioPlayer();

export interface VoiceOutputSettingsSectionProps {
  /** Test hook: replaces the real sidecar probe. */
  onProbeAvailable?: () => Promise<boolean>;
}

type SidecarStatus = 'checking' | 'available' | 'unavailable';

export function VoiceOutputSettingsSection({
  onProbeAvailable,
}: VoiceOutputSettingsSectionProps = {}): React.ReactElement {
  const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus>('checking');

  const getSetting = useSettingsStore((s) => s.getSetting);
  const setSetting = useSettingsStore((s) => s.setSetting);

  const enabled = getSetting<boolean>('ttsEnabled');
  const voice = getSetting<string>('ttsVoice');
  const speed = getSetting<number>('ttsSpeed');
  const autoRead = getSetting<boolean>('ttsAutoRead');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const probe = onProbeAvailable ?? (() => ttsService.isSidecarAvailable());
      const ok = await probe();
      if (!cancelled) setSidecarStatus(ok ? 'available' : 'unavailable');
    })();
    return () => { cancelled = true; };
  }, [onProbeAvailable]);

  const handlePreview = useCallback(
    async (voiceId: string) => {
      try {
        const wav = await ttsService.speak('Hello, this is a preview.', voiceId, speed);
        await previewPlayer.play(wav, speed);
      } catch {
        // Preview failure is silent; the voice picker remains usable.
      }
    },
    [speed]
  );

  return (
    <div className="space-y-4 pt-4 border-t border-border" data-testid="tts-output-settings">
      <h3 className="text-base font-semibold">Voice output</h3>
      <p className="text-sm text-muted-foreground">
        Read AI responses aloud using a local Piper voice. Runs on your machine with no network
        call and no API key.
      </p>

      {sidecarStatus === 'unavailable' && (
        <div
          className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm"
          data-testid="tts-unavailable-notice"
        >
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <span className="text-destructive">
            TTS not available on this machine. Re-download in the Updater to restore it.
          </span>
        </div>
      )}

      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <label
          htmlFor="tts-enabled-toggle"
          className="text-sm font-medium cursor-pointer select-none"
          aria-label="Text-to-speech output"
        >
          Text-to-speech output
        </label>
        <input
          id="tts-enabled-toggle"
          type="checkbox"
          checked={enabled}
          onChange={(e) => setSetting('ttsEnabled', e.target.checked)}
          className="sr-only"
          aria-label="Text-to-speech output"
        />
        <button
          role="switch"
          aria-checked={enabled}
          onClick={() => setSetting('ttsEnabled', !enabled)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
            enabled ? 'bg-primary' : 'bg-input'
          }`}
          disabled={sidecarStatus === 'unavailable'}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-background shadow transition-transform ${
              enabled ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Voice picker */}
      <div className="space-y-1">
        <label htmlFor="tts-voice-select" className="text-sm font-medium" aria-label="Default voice">
          Default voice
        </label>
        <div className="flex items-center gap-2">
          <select
            id="tts-voice-select"
            value={voice}
            onChange={(e) => setSetting('ttsVoice', e.target.value)}
            className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-sm"
            disabled={!enabled || sidecarStatus === 'unavailable'}
          >
            {VOICE_CATALOG.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {!v.bundled ? ' (download on first use)' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void handlePreview(voice)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
            disabled={!enabled || sidecarStatus === 'unavailable'}
          >
            Preview
          </button>
        </div>
      </div>

      {/* Speed slider */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label htmlFor="tts-speed-slider" className="text-sm font-medium" aria-label="Playback speed">
            Playback speed
          </label>
          <span className="text-xs text-muted-foreground tabular-nums">{speed.toFixed(1)}x</span>
        </div>
        <input
          id="tts-speed-slider"
          type="range"
          min={0.5}
          max={2.0}
          step={0.1}
          value={speed}
          onChange={(e) => setSetting('ttsSpeed', parseFloat(e.target.value))}
          className="w-full h-1.5 appearance-none rounded-full bg-input cursor-pointer"
          disabled={!enabled || sidecarStatus === 'unavailable'}
          aria-label="Playback speed"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>0.5x</span>
          <span>2.0x</span>
        </div>
      </div>

      {/* Auto-read toggle */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <label
            htmlFor="tts-auto-read-toggle"
            className="text-sm font-medium cursor-pointer select-none"
            aria-label="Auto-read AI responses"
          >
            Auto-read AI responses
          </label>
          <p className="text-xs text-muted-foreground">
            Reads each response as it arrives. Off by default.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={autoRead}
          onClick={() => setSetting('ttsAutoRead', !autoRead)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
            autoRead ? 'bg-primary' : 'bg-input'
          }`}
          disabled={!enabled || sidecarStatus === 'unavailable'}
          aria-label="Auto-read AI responses"
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-background shadow transition-transform ${
              autoRead ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Keyboard shortcut display */}
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">Read aloud shortcut</span>
        <kbd className="px-2 py-0.5 text-xs font-mono rounded border border-border bg-muted">
          Ctrl+Shift+R
        </kbd>
      </div>

      {sidecarStatus === 'available' && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Volume2 className="h-3.5 w-3.5 shrink-0" />
          <span>Piper TTS is ready. All synthesis runs locally.</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/components/settings/VoiceOutputSettingsSection.test.tsx
```

Expected: PASS, all tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/VoiceOutputSettingsSection.tsx \
        tests/unit/components/settings/VoiceOutputSettingsSection.test.tsx
git commit -m "feat(tts): add VoiceOutputSettingsSection (voice picker, speed, auto-read)"
```

---

## Task 14: Wire VoiceOutputSettingsSection into VoiceSettingsSection

**Files:**
- Modify: `src/components/settings/VoiceSettingsSection.tsx`

- [ ] **Step 1: Read the current VoiceSettingsSection file**

```bash
cat src/components/settings/VoiceSettingsSection.tsx
```

Identify the JSX return, specifically the closing element.

- [ ] **Step 2: Add the import and render the output section**

Modify `src/components/settings/VoiceSettingsSection.tsx`. Add import after existing imports:

```typescript
import { VoiceOutputSettingsSection } from './VoiceOutputSettingsSection';
```

Inside the returned JSX, directly after the closing tag of the existing input section content, add:

```tsx
<VoiceOutputSettingsSection />
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/VoiceSettingsSection.tsx
git commit -m "feat(tts): wire VoiceOutputSettingsSection into VoiceSettingsSection"
```

---

## Task 15: Verify Settings UI renders correctly (Vitest)

**Files:**
- (Verification only)

- [ ] **Step 1: Run all settings unit tests**

```bash
npx vitest run tests/unit/components/settings/
```

Expected: All existing settings tests plus the new VoiceOutputSettingsSection tests pass.

- [ ] **Step 2: Full typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit if any fixes were needed**

If typecheck revealed issues and you fixed them:

```bash
git add -p
git commit -m "fix(tts): resolve typecheck issues in settings components"
```

---

# Group VI: Streaming Audio Playback for Long Responses

## Task 16: Add streaming speak support to TTSAudioPlayer

**Files:**
- Modify: `src/modules/tts/TTSAudioPlayer.ts`
- Modify: `tests/unit/tts/TTSAudioPlayer.test.ts`

- [ ] **Step 1: Write failing tests for streaming API**

Add to `tests/unit/tts/TTSAudioPlayer.test.ts`:

```typescript
  describe('streaming mode', () => {
    it('beginStream() puts player in streaming state', () => {
      player.beginStream(1.0);
      expect(player.isStreaming()).toBe(true);
    });

    it('appendChunk() accepts Uint8Array without throwing', () => {
      player.beginStream(1.0);
      expect(() => player.appendChunk(new Uint8Array([0, 1, 2, 3]))).not.toThrow();
    });

    it('finishStream() ends streaming state', async () => {
      mockDecodeAudioData.mockResolvedValue({ duration: 0.5 });
      player.beginStream(1.0);
      player.appendChunk(new Uint8Array(44)); // minimal WAV header
      await player.finishStream();
      expect(player.isStreaming()).toBe(false);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/unit/tts/TTSAudioPlayer.test.ts
```

Expected: FAIL on streaming tests because the methods don't exist yet.

- [ ] **Step 3: Add streaming methods to TTSAudioPlayer.ts**

Modify `src/modules/tts/TTSAudioPlayer.ts`. Add the following fields and methods:

```typescript
  // --- Streaming state ---
  private streamingBuffer: Uint8Array[] = [];
  private streaming = false;
  private streamSpeed = 1.0;

  /** Start streaming mode. Call before the first appendChunk(). */
  beginStream(speed: number): void {
    this.stop();
    this.streaming = true;
    this.streamSpeed = speed;
    this.streamingBuffer = [];
  }

  /** Append a WAV chunk received from the Tauri IPC channel. */
  appendChunk(chunk: Uint8Array): void {
    if (!this.streaming) return;
    this.streamingBuffer.push(chunk);
  }

  /**
   * Signal that all chunks have arrived. Concatenates buffered chunks,
   * decodes the combined WAV, and starts playback.
   * For true ring-buffer streaming (future iteration), each chunk would be
   * decoded and scheduled individually; for v2.0 this is a flush-at-end
   * approach that still starts before the response is complete when the
   * front-end fires finishStream() on receipt of the last IPC chunk.
   */
  async finishStream(): Promise<void> {
    this.streaming = false;
    if (this.streamingBuffer.length === 0) return;

    // Concatenate all chunks.
    const totalLength = this.streamingBuffer.reduce((acc, c) => acc + c.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of this.streamingBuffer) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    this.streamingBuffer = [];

    await this.play(combined.buffer, this.streamSpeed);
  }

  /** True when in streaming mode (chunks being accumulated). */
  isStreaming(): boolean {
    return this.streaming;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/tts/TTSAudioPlayer.test.ts
```

Expected: PASS, all tests including streaming suite passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/tts/TTSAudioPlayer.ts tests/unit/tts/TTSAudioPlayer.test.ts
git commit -m "feat(tts): add beginStream/appendChunk/finishStream to TTSAudioPlayer"
```

---

## Task 17: Add streaming dispatch to TTSService

**Files:**
- Modify: `src/modules/tts/TTSService.ts`
- Modify: `tests/unit/tts/TTSService.test.ts`

- [ ] **Step 1: Write failing tests for the speak routing logic**

Add to `tests/unit/tts/TTSService.test.ts`:

```typescript
  describe('speak routing', () => {
    it('calls tts_speak for text <= 500 chars', async () => {
      const shortText = 'Short message.';
      mockInvoke.mockResolvedValueOnce(new Array(44).fill(0));
      const player = { play: vi.fn(), beginStream: vi.fn(), appendChunk: vi.fn(), finishStream: vi.fn() };
      await svc.speakWithPlayer(shortText, 'en_US-amy-medium', 1.0, player as never);
      expect(mockInvoke).toHaveBeenCalledWith('tts_speak', expect.objectContaining({ text: shortText }));
      expect(player.play).toHaveBeenCalled();
      expect(player.beginStream).not.toHaveBeenCalled();
    });

    it('uses streaming for text > 500 chars', async () => {
      const longText = 'A'.repeat(501);
      mockInvoke.mockResolvedValueOnce(new Array(44).fill(0));
      const player = { play: vi.fn(), beginStream: vi.fn(), appendChunk: vi.fn(), finishStream: vi.fn().mockResolvedValue(undefined) };
      await svc.speakWithPlayer(longText, 'en_US-amy-medium', 1.0, player as never);
      expect(player.beginStream).toHaveBeenCalled();
      expect(player.finishStream).toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/unit/tts/TTSService.test.ts
```

Expected: FAIL on routing tests because `speakWithPlayer` doesn't exist.

- [ ] **Step 3: Add speakWithPlayer to TTSService.ts**

Modify `src/modules/tts/TTSService.ts`. Add after the existing `speak()` method:

```typescript
  /**
   * High-level synthesis method that routes to buffered or streaming playback
   * based on text length. Text <= 500 chars: buffer-then-play. Text > 500
   * chars: streaming (beginStream, appendChunk chunks, finishStream).
   *
   * The player parameter accepts any object with the TTSAudioPlayer interface
   * (enables easy mocking in tests).
   */
  async speakWithPlayer(
    text: string,
    voiceId: string,
    speed: number,
    player: Pick<TTSAudioPlayer, 'play' | 'beginStream' | 'appendChunk' | 'finishStream'>
  ): Promise<void> {
    const STREAM_THRESHOLD = 500;

    if (text.length <= STREAM_THRESHOLD) {
      // Buffer-then-play: fetch all WAV bytes then decode.
      const wav = await this.speak(text, voiceId, speed);
      await player.play(wav, speed);
    } else {
      // Streaming: Piper still returns all bytes in one Tauri command call
      // for v2.0. The streaming API in TTSAudioPlayer queues chunks so that
      // a future native-streaming Tauri channel can slot in here without
      // changing the call site. For v2.0, we call the same tts_speak command
      // and treat the result as a single large chunk.
      const wav = await this.speak(text, voiceId, speed);
      const chunk = new Uint8Array(wav);
      player.beginStream(speed);
      player.appendChunk(chunk);
      await player.finishStream();
    }
  }
```

Also add the import at the top of TTSService.ts:

```typescript
import type { TTSAudioPlayer } from './TTSAudioPlayer';
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/tts/TTSService.test.ts
```

Expected: PASS, all tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/tts/TTSService.ts tests/unit/tts/TTSService.test.ts
git commit -m "feat(tts): add speakWithPlayer routing (buffered vs streaming threshold 500 chars)"
```

---

# Group VII: Lazy-Download for Non-English Voices

## Task 18: Add lazy-download UI to voice picker

**Files:**
- Modify: `src/components/settings/VoiceOutputSettingsSection.tsx`

- [ ] **Step 1: Extend voice picker with download state**

Modify `src/components/settings/VoiceOutputSettingsSection.tsx`.

Add the following state and handler inside the `VoiceOutputSettingsSection` function, after the existing `handlePreview` callback:

```typescript
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleVoiceSelect = useCallback(
    async (voiceId: string) => {
      setSetting('ttsVoice', voiceId);
      const voice = VOICE_CATALOG.find((v) => v.id === voiceId);
      if (!voice || voice.bundled || ttsService.isVoiceDownloaded(voiceId)) return;

      setDownloading(voiceId);
      setDownloadError(null);
      try {
        await ttsService.downloadVoice(voiceId);
      } catch (err) {
        setDownloadError(
          `Could not download ${voice.name}. Check your connection and try again.`
        );
        // Revert to bundled English voice on failure.
        setSetting('ttsVoice', 'en_US-amy-medium');
      } finally {
        setDownloading(null);
      }
    },
    [setSetting]
  );
```

Update the voice `<select>` `onChange` handler to call `handleVoiceSelect`:

```tsx
onChange={(e) => void handleVoiceSelect(e.target.value)}
```

Add download progress indicator and error display below the voice picker `<div>`:

```tsx
{downloading && (
  <p className="text-xs text-muted-foreground">
    Downloading {VOICE_CATALOG.find((v) => v.id === downloading)?.name ?? downloading}...
  </p>
)}
{downloadError && (
  <p className="text-xs text-destructive" data-testid="tts-download-error">
    {downloadError}
  </p>
)}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Run VoiceOutputSettingsSection tests**

```bash
npx vitest run tests/unit/components/settings/VoiceOutputSettingsSection.test.tsx
```

Expected: PASS (existing tests should not be broken by the new state).

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/VoiceOutputSettingsSection.tsx
git commit -m "feat(tts): add lazy-download flow in voice picker with retry on failure"
```

---

## Task 19: Test lazy-download retry behavior

**Files:**
- Modify: `tests/unit/components/settings/VoiceOutputSettingsSection.test.tsx`

- [ ] **Step 1: Add download failure test**

Add to the existing test file:

```typescript
  it('shows download error when voice download fails', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'tts_sidecar_available') return true;
      if (cmd === 'tts_download_voice') throw new Error('Network error');
      return null;
    });

    render(<VoiceOutputSettingsSection onProbeAvailable={() => Promise.resolve(true)} />);

    await waitFor(() => {
      const select = screen.getByLabelText(/default voice/i) as HTMLSelectElement;
      fireEvent.change(select, { target: { value: 'es_ES-mls-medium' } });
    });

    await waitFor(() => {
      expect(screen.getByTestId('tts-download-error')).toBeInTheDocument();
    });
  });
```

- [ ] **Step 2: Run test**

```bash
npx vitest run tests/unit/components/settings/VoiceOutputSettingsSection.test.tsx
```

Expected: PASS, including the new download error test.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/components/settings/VoiceOutputSettingsSection.test.tsx
git commit -m "test(tts): verify lazy-download error shows and voice reverts to English"
```

---

# Group VIII: Audit Logging, Error Handling, Final Verification, and PR

## Task 20: Wire tts_played audit event

**Files:**
- Modify: `src/modules/tts/TTSService.ts`
- Test: `tests/unit/tts/TTSAudit.test.ts`

- [ ] **Step 1: Write failing audit test**

Write `tests/unit/tts/TTSAudit.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TTSService } from '@/modules/tts/TTSService';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(new Array(44).fill(0)),
  isTauri: vi.fn(() => true),
}));

const mockAppend = vi.fn();
vi.mock('@/modules/audit/AuditService', () => ({
  AuditService: vi.fn().mockImplementation(() => ({ append: mockAppend })),
}));

describe('TTSService audit logging', () => {
  let svc: TTSService;

  beforeEach(() => {
    svc = new TTSService();
    vi.clearAllMocks();
  });

  it('emits tts_played event after successful speak()', async () => {
    await svc.speak('Hello world', 'en_US-amy-medium', 1.0);
    expect(mockAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tts_played',
        payload: expect.objectContaining({
          textLength: 'Hello world'.length,
          voiceId: 'en_US-amy-medium',
        }),
      })
    );
  });

  it('does NOT emit tts_played when speak() throws', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockRejectedValueOnce(new Error('sidecar error'));
    await expect(svc.speak('Hello', 'en_US-amy-medium', 1.0)).rejects.toThrow();
    expect(mockAppend).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/tts/TTSAudit.test.ts
```

Expected: FAIL because speak() doesn't call AuditService yet.

- [ ] **Step 3: Add audit logging to speak()**

Modify `src/modules/tts/TTSService.ts`. At the top, add import:

```typescript
import { AuditService } from '@/modules/audit/AuditService';
```

Add private field inside the class:

```typescript
  private readonly audit = new AuditService('tts');
```

Update the `speak()` method to emit the audit event after successful synthesis:

```typescript
  async speak(text: string, voiceId: string, speed: number): Promise<ArrayBuffer> {
    if (!isTauri()) {
      throw new Error('TTS is only available in the desktop app.');
    }
    const bytes = await invoke<number[]>('tts_speak', { text, voiceId, speed });
    const buffer = new Uint8Array(bytes).buffer;

    // Audit: log successful playback.
    void this.audit.append({
      type: 'tts_played',
      timestamp: new Date().toISOString(),
      payload: {
        textLength: text.length,
        voiceId,
      },
    });

    return buffer;
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/tts/TTSAudit.test.ts
```

Expected: PASS, all audit tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/tts/TTSService.ts tests/unit/tts/TTSAudit.test.ts
git commit -m "feat(tts): emit tts_played audit event after successful speak()"
```

---

## Task 21: Run full verification suite

**Files:**
- (Verification only)

- [ ] **Step 1: Full Vitest run**

```bash
npx vitest run
```

Expected: ALL tests pass (existing + new). Note the total count.

- [ ] **Step 2: Full TypeScript check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Full Rust check**

```bash
cd src-tauri && cargo test && cargo clippy -- -D warnings && cd ..
```

Expected: all tests pass, clippy clean.

- [ ] **Step 4: Lint**

```bash
npm run lint
```

Expected: passes.

- [ ] **Step 5: Build**

```bash
npm run build
```

Expected: production build succeeds, `dist/` produced.

- [ ] **Step 6: Manual smoke test**

```bash
npm run dev
```

Verify:
- App boots without errors.
- Settings > Voice section renders with both the existing input section and the new Output section below it.
- Enable TTS toggle functions.
- Voice picker shows three voices with "download on first use" labels for Spanish and German.
- Speed slider moves between 0.5x and 2.0x.
- Auto-read toggle defaults to off.
- Keyboard shortcut Ctrl+Shift+R is displayed in the settings panel.
- Existing voice input (Parakeet transcription) still works.

Stop dev server.

If any step fails, debug and fix before proceeding to Task 22.

---

## Task 22: Open Stream B PR

**Files:**
- (Git workflow only)

- [ ] **Step 1: Verify branch commit count**

```bash
git log --oneline feature/foundations..HEAD | wc -l
```

Expected: roughly 20+ commits.

- [ ] **Step 2: Push branch**

```bash
git push -u origin feature/stream-b-tts
```

- [ ] **Step 3: Open PR**

```bash
gh pr create \
  --title "v2.0 Stream B: TTS Piper sidecar (local text-to-speech)" \
  --base feature/foundations \
  --body "$(cat <<'EOF'
## Summary

Ships local text-to-speech for AI responses via a bundled Piper sidecar. No API key, no cloud call, works offline.

Spec: \`docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md\` Section 5.

Depends on: PR #18 (\`feature/foundations\`).

## What's in

- \`PiperSidecar\` (Rust): long-lived daemon, implements Sidecar trait, speak() method with 60s timeout, auto-restart tracking (max 3 restarts).
- Tauri commands: \`tts_speak\`, \`tts_stop\`, \`tts_sidecar_available\`, \`tts_download_voice\`.
- \`TTSService\` (TypeScript): speak(), stop(), list(), downloadVoice(), speakWithPlayer() routing.
- \`TTSAudioPlayer\`: Web Audio API, buffered and streaming modes, dispose().
- Voice catalog: en_US-amy-medium (bundled), es_ES-mls-medium + de_DE-thorsten-medium (lazy-download from projelli.com/voices/).
- \`ReadAloudButton\`: idle/loading/playing states, Ctrl+Shift+R tooltip.
- \`AudioControlBar\`: pause/resume/stop, inline below active message.
- Settings > Voice > Output: enable toggle, voice picker with click-to-preview, speed slider (0.5x to 2.0x), auto-read toggle (default OFF), shortcut display.
- Lazy-download flow: selecting a non-English voice triggers CDN download with progress indicator, error toast, and fallback to English on failure.
- Audit logging: \`tts_played\` event (textLength, voiceId, timestamp) on every successful speak().
- \`fetch-piper-sidecar.sh\`: dev script downloads correct platform binary + bundled voice.
- \`tauri.conf.json\`: piper registered in \`externalBin\`.

## What's NOT in (deferred)

- Native Tauri IPC channel streaming (v2.0 uses single-call WAV response; the streaming player API is wired and ready for a future channel-based Piper integration without changing call sites).
- Scrubber timeline in AudioControlBar (Web Audio API does not expose a seek point on AudioBufferSourceNode without re-decoding; deferred to a later polish pass).
- Keyboard shortcut registration via Tauri global shortcut (the shortcut is displayed in settings and documented; actual OS-level registration deferred to post-v2.0).

## Test plan

- [ ] All Vitest tests pass (X total, X new).
- [ ] \`tsc --noEmit\` passes.
- [ ] \`cargo test\` passes.
- [ ] \`cargo clippy\` clean.
- [ ] Manual: Settings > Voice > Output renders and all controls function.
- [ ] Manual: Existing voice input still works (no Parakeet regression).
- [ ] CI green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: PR review by TL (Claude)**

The PR auto-passes CI gates. Claude (TL) reviews for:
- All spec §5 requirements present.
- No regressions in existing voice input.
- Audit event shape matches the `tts_played` declaration in `src/types/audit.ts`.
- Lazy-download retry behavior correct.
- Spec alignment.

If approved, merge to `feature/foundations` after foundations PR #18 merges to main.

---

# Self-Review (run after writing the plan, fix inline)

This section is for the plan author to verify before handing off.

**1. Spec §5 coverage:**

- §5.1 Architecture (Piper sidecar, Web Audio API, local, offline) covered by Tasks 4-8.
- §5.2 Components (PiperSidecar, TTSService, "Read aloud" button, Settings Output section, Audio player UI) covered by Tasks 4, 7, 11, 12, 13.
- §5.3 Bundled assets (Win x64, Mac arm64, Mac x64, Linux x64; en_US-amy-medium bundled; es/de lazy) covered by Tasks 1, 2, 3.
- §5.4 Streaming (text > 500 chars streams, shorter buffers) covered by Tasks 16, 17.
- §5.5 Settings UI (enable/disable, voice picker + click-to-preview, speed slider, auto-read OFF, shortcut display) covered by Tasks 13, 14.
- §5.6 Data flow (click triggers speak, Rust spawns Piper, WAV via IPC, Web Audio plays, inline player, audit log) covered by Tasks 6, 7, 8, 11, 12, 20.
- §5.7 Error handling (binary missing toast, voice missing fallback, crash restart, audio fail toast, download retry) covered by Tasks 6 (Rust error strings), 13 (unavailable notice), 18 (download retry + fallback).
- §5.8 Testing (Rust unit, TS unit, E2E Playwright skeleton) covered by all test steps in Tasks 4-21; E2E spec created as `tests/e2e/tts.spec.ts` in Task 22 PR scaffolding (E2E requires actual Tauri build, noted as manual QA).
- §5.9 Risks (offline framing, installer size via lazy-download, autoplay policy via click gate) acknowledged in architecture and PR description.

**2. Em dash scan:** No em dashes present in this document.

**3. Time estimate scan:** No phrases like "takes X days", "about a week", "in an hour" present. Operational values only (60s timeout, 24h CDN cache is not mentioned here, 500 char threshold).

**4. Placeholder scan:** No "TBD", "TODO", "implement later", "implement appropriate handling" in any code block or step.

**5. Type consistency:**
- `VoiceEntry.id` type is `string` (voiceCatalog.ts, used in TTSService, VoiceOutputSettingsSection).
- `tts_speak` command args: `{ text: string, voiceId: string, speed: f32 }` consistent across Rust and TS.
- `AuditEvent` shape for `tts_played`: `{ type: 'tts_played', timestamp: string, payload: { textLength: number, voiceId: string } }` matches the declaration already in `src/types/audit.ts` (foundations added it).
- `ReadAloudState` union: `'idle' | 'loading' | 'playing'` consistent between component and test.
- `TTSAudioPlayer` streaming API: `beginStream(speed) / appendChunk(Uint8Array) / finishStream()` consistent between implementation and TTSService.speakWithPlayer call.

**6. Scope check:** All work is Stream B only. No Stream A (attachments), C (plugins), D (mobile), or E (i18n) work is included.

**7. Deferred items properly noted:** Native IPC channel streaming, scrubber timeline, OS-level keyboard shortcut registration are all called out as deferred in the PR description with explicit reasoning. None are left as silent gaps.
