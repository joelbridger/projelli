#!/usr/bin/env bash
# scripts/build-diarize-sidecar.sh — build lantern-diarize and stage it into
# src-tauri/binaries/ (bundled via the binaries/**/* resource glob, same mode
# as the parakeet binary — NOT externalBin).
#
# sherpa-rs links sherpa-onnx dynamically on this platform (the "static"
# feature's prebuilt archive lacks the diarization/speaker-id symbols this
# sidecar calls — see the note in sidecar-src/lantern-diarize/Cargo.toml), so
# the shared libs it depends on are staged alongside the binary. The crate's
# .cargo/config.toml sets an $ORIGIN/@loader_path rpath (Linux/macOS) so the
# binary finds them next to itself regardless of caller cwd; Windows resolves
# DLLs beside the .exe by default and needs no equivalent.
# Optional TARGET_TRIPLE (same env var convention as fetch-piper-sidecar.sh /
# fetch-llama-sidecar.sh) cross-builds for a specific target — needed on the
# macOS release matrix, where one job builds --target aarch64-apple-darwin
# and another --target x86_64-apple-darwin on the same (Apple Silicon)
# runner; a plain host build would stage the wrong arch into the x86_64 app.
set -euo pipefail
cd "$(dirname "$0")/.."
pushd src-tauri/sidecar-src/lantern-diarize >/dev/null
if [[ -n "${TARGET_TRIPLE:-}" ]]; then
  rustup target add "$TARGET_TRIPLE" >/dev/null 2>&1 || true
  cargo build --release --target "$TARGET_TRIPLE"
else
  cargo build --release
fi
popd >/dev/null
mkdir -p src-tauri/binaries
if [[ -n "${TARGET_TRIPLE:-}" ]]; then
  RELEASE_DIR="${CARGO_TARGET_DIR:-src-tauri/sidecar-src/lantern-diarize/target}/$TARGET_TRIPLE/release"
else
  RELEASE_DIR="${CARGO_TARGET_DIR:-src-tauri/sidecar-src/lantern-diarize/target}/release"
fi
BIN="$RELEASE_DIR/lantern-diarize"
DST=src-tauri/binaries/lantern-diarize
if [[ "${OS:-}" == "Windows_NT" ]]; then BIN="$BIN.exe"; DST="$DST.exe"; fi
cp "$BIN" "$DST"
echo "staged $DST"

shopt -s nullglob
LIB_PATTERNS=("$RELEASE_DIR"/libsherpa-onnx-c-api.* "$RELEASE_DIR"/libonnxruntime.* "$RELEASE_DIR"/*sherpa-onnx-c-api.dll "$RELEASE_DIR"/*onnxruntime*.dll)
for lib in "${LIB_PATTERNS[@]}"; do
  [[ -f "$lib" ]] || continue
  cp "$lib" "src-tauri/binaries/$(basename "$lib")"
  echo "staged src-tauri/binaries/$(basename "$lib")"
done
shopt -u nullglob
