#!/usr/bin/env bash
# Prepare the local-only meeting voice bundle for a Tauri installer.
#
# This is intentionally a staging command, not an externalBin declaration:
# whisper and lantern-diarize are found at runtime under Tauri's bundled
# `resources/**/*` / `binaries/**/*` trees. Keeping the complete sequence in
# one command prevents a manual Windows build from silently omitting either
# executable or its required models.
#
# Usage:
#   npm run stage-meeting-voice-sidecars
#   TARGET_TRIPLE=x86_64-pc-windows-msvc npm run stage-meeting-voice-sidecars
#
# The model download scripts pin and verify SHA-256 digests. The executable
# builds pin their source inputs (the whisper.cpp commit and Cargo.lock) and
# deliberately leave the resulting platform-specific binaries untracked.
set -euo pipefail

cd "$(dirname "$0")/.."

TARGET_TRIPLE="${TARGET_TRIPLE:-}"
if [[ -z "$TARGET_TRIPLE" ]]; then
  case "$(uname -s)/$(uname -m)" in
    Linux/x86_64) TARGET_TRIPLE="x86_64-unknown-linux-gnu" ;;
    Darwin/arm64) TARGET_TRIPLE="aarch64-apple-darwin" ;;
    Darwin/x86_64) TARGET_TRIPLE="x86_64-apple-darwin" ;;
    MINGW64_NT-*/*|MSYS_NT-*/*|CYGWIN_NT-*/*) TARGET_TRIPLE="x86_64-pc-windows-msvc" ;;
    *) echo "Unsupported platform: $(uname -s)/$(uname -m)" >&2; exit 1 ;;
  esac
fi

case "$TARGET_TRIPLE" in
  x86_64-unknown-linux-gnu|aarch64-apple-darwin|x86_64-apple-darwin|x86_64-pc-windows-msvc) ;;
  *) echo "Unsupported meeting-voice target triple: $TARGET_TRIPLE" >&2; exit 1 ;;
esac

echo "Staging checksum-verified meeting voice models for $TARGET_TRIPLE..."
bash scripts/fetch-voice-models.sh
bash scripts/fetch-diarize-models.sh

echo "Building pinned meeting voice sidecars for $TARGET_TRIPLE..."
TARGET_TRIPLE="$TARGET_TRIPLE" bash scripts/build-voice-sidecar.sh
TARGET_TRIPLE="$TARGET_TRIPLE" bash scripts/build-diarize-sidecar.sh

if [[ "$TARGET_TRIPLE" == "x86_64-pc-windows-msvc" ]]; then
  whisper="src-tauri/binaries/whisper.exe"
  diarize="src-tauri/binaries/diarize/lantern-diarize.exe"
else
  whisper="src-tauri/binaries/whisper"
  diarize="src-tauri/binaries/diarize/lantern-diarize"
fi

for required in \
  "$whisper" \
  "$diarize" \
  src-tauri/resources/voice/models/ggml-tiny.en.bin \
  src-tauri/resources/voice/models/ggml-base.en.bin \
  src-tauri/resources/diarize/segmentation.onnx \
  src-tauri/resources/diarize/embedding.onnx; do
  test -s "$required" || { echo "Required meeting-voice asset is missing: $required" >&2; exit 1; }
done

if [[ "$TARGET_TRIPLE" == "x86_64-pc-windows-msvc" ]]; then
  compgen -G 'src-tauri/binaries/diarize/*sherpa-onnx-c-api.dll' >/dev/null || { echo "Required diarization sherpa DLL is missing" >&2; exit 1; }
  compgen -G 'src-tauri/binaries/diarize/*onnxruntime*.dll' >/dev/null || { echo "Required diarization ONNX Runtime DLL is missing" >&2; exit 1; }
fi

echo "Meeting voice sidecars staged for $TARGET_TRIPLE."
