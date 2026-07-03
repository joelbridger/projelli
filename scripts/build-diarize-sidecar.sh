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
set -euo pipefail
cd "$(dirname "$0")/.."
pushd src-tauri/sidecar-src/lantern-diarize >/dev/null
cargo build --release
popd >/dev/null
mkdir -p src-tauri/binaries
RELEASE_DIR="${CARGO_TARGET_DIR:-src-tauri/sidecar-src/lantern-diarize/target}/release"
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
