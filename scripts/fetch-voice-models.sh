#!/usr/bin/env bash
# scripts/fetch-voice-models.sh — download the pinned ggml voice-transcription
# models into src-tauri/resources/voice/models/ (bundled via the
# resources/**/* glob already in tauri.conf.json). Mirrors
# scripts/fetch-diarize-models.sh: pinned URLs + SHA256 verification.
#
# Only `tiny.en` + `base.en` are bundled — an install-size trade-off, not an
# oversight. `small.en` is ~466 MB (vs. 75/148 MB for tiny/base); a `small`
# transcription request honestly falls back to `base` at runtime (see
# `resolve_model_path` in src-tauri/src/sidecars/parakeet.rs) rather than
# erroring or silently bundling another few hundred MB into every install.
# Bundling `small.en` too is a mechanical follow-up — add its URL + SHA256
# below — once the resulting installer-size increase is reviewed.
set -euo pipefail
cd "$(dirname "$0")/.."
DEST=src-tauri/resources/voice/models
mkdir -p "$DEST"

# Pinned to ggerganov/whisper.cpp's own HuggingFace model releases (the
# canonical ggml conversions of OpenAI's Whisper weights), verified
# 2026-07-04 by downloading fresh and computing SHA256 ourselves — same
# pattern as fetch-diarize-models.sh/fetch-piper-sidecar.sh, which also pin
# a SHA256 computed from a verified-good download rather than trusting a
# third party's own checksum file.
TINY_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin"
TINY_SHA256="921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f"
BASE_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
BASE_SHA256="a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002"

fetch () { # url dest sha256
  local url="$1" dest="$2" want="$3"
  if [[ -f "$dest" ]]; then echo "have $dest"; else curl -fL --retry 3 -o "$dest" "$url"; fi
  local got
  # sha256sum is not installed by default on macOS; shasum -a 256 is the
  # portable fallback (same pattern as scripts/fetch-piper-sidecar.sh).
  if command -v sha256sum &>/dev/null; then
    got=$(sha256sum "$dest" | cut -d' ' -f1)
  else
    got=$(shasum -a 256 "$dest" | cut -d' ' -f1)
  fi
  [[ "$got" == "$want" ]] || { echo "SHA256 mismatch for $dest: got $got want $want" >&2; exit 1; }
}

fetch "$TINY_URL" "$DEST/ggml-tiny.en.bin" "$TINY_SHA256"
fetch "$BASE_URL" "$DEST/ggml-base.en.bin" "$BASE_SHA256"
echo "voice models staged in $DEST"
