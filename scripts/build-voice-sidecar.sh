#!/usr/bin/env bash
# scripts/build-voice-sidecar.sh — build the real whisper.cpp CLI
# (`whisper-cli`) and stage it into src-tauri/binaries/whisper[.exe]
# (bundled via the binaries/**/* resource glob already in tauri.conf.json —
# NOT externalBin, same mode as the parakeet/diarize binaries). Staged under
# the name `whisper` (not `whisper-cli`) so it's found by the existing
# candidate-name lookup in `resolve_sidecar_path`
# (src-tauri/src/commands/voice.rs), which predates this script and already
# ships tested for the names `parakeet` / `whisper`.
#
# Built with -DBUILD_SHARED_LIBS=OFF so `whisper-cli` is a single static
# binary with no sibling ggml/whisper runtime libs — verified via `ldd` on
# Linux (only ordinary system libs: libgomp/libstdc++/libm/libgcc_s/libc,
# nothing whisper/ggml-specific). This sidesteps the exact
# onnxruntime-DLL-collision problem scripts/build-diarize-sidecar.sh had to
# solve with a dedicated binaries/diarize/ subfolder (see its own comment) —
# there's nothing here to collide with piper's or llama.cpp's libs, so
# `whisper` stays in flat binaries/ next to them.
#
# Pinned to a specific ggml-org/whisper.cpp commit (not a moving branch) —
# this is the exact commit built and verified end-to-end (a real
# transcription of the project's own samples/jfk.wav) on 2026-07-04. Bump
# deliberately, re-verify with --help + a real transcription before pinning
# a new commit.
#
# Optional TARGET_TRIPLE (same convention as fetch-piper-sidecar.sh /
# fetch-llama-sidecar.sh / build-diarize-sidecar.sh) cross-builds for a
# specific target — needed on the macOS release matrix, where one job builds
# --target aarch64-apple-darwin and another --target x86_64-apple-darwin on
# the same (Apple Silicon) runner.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"
WHISPER_CPP_COMMIT="6fc7c33b4c3a2cec83e4b65abd5e96a890480375"
SRC_DIR="$REPO_ROOT/src-tauri/sidecar-src/whisper-cpp"
BUILD_DIR="$SRC_DIR/build"

if [[ ! -d "$SRC_DIR/.git" ]]; then
  rm -rf "$SRC_DIR"
  git clone https://github.com/ggml-org/whisper.cpp.git "$SRC_DIR"
fi
pushd "$SRC_DIR" >/dev/null
git fetch --depth 1 origin "$WHISPER_CPP_COMMIT"
git checkout --detach "$WHISPER_CPP_COMMIT"
popd >/dev/null

CMAKE_ARGS=(-DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF)
case "${TARGET_TRIPLE:-}" in
  aarch64-apple-darwin) CMAKE_ARGS+=(-DCMAKE_OSX_ARCHITECTURES=arm64) ;;
  x86_64-apple-darwin) CMAKE_ARGS+=(-DCMAKE_OSX_ARCHITECTURES=x86_64) ;;
esac

JOBS="$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"
cmake -B "$BUILD_DIR" -S "$SRC_DIR" "${CMAKE_ARGS[@]}"
cmake --build "$BUILD_DIR" --config Release --target whisper-cli -j"$JOBS"

DEST_DIR="$REPO_ROOT/src-tauri/binaries"
mkdir -p "$DEST_DIR"
if [[ "${OS:-}" == "Windows_NT" ]]; then
  # MSVC's generator is multi-config: the binary lands under bin/Release/,
  # not bin/ directly (unlike the single-config Makefiles/Ninja generator
  # used on Linux/macOS).
  BIN="$BUILD_DIR/bin/Release/whisper-cli.exe"
  DST="$DEST_DIR/whisper.exe"
else
  BIN="$BUILD_DIR/bin/whisper-cli"
  DST="$DEST_DIR/whisper"
fi
cp "$BIN" "$DST"
chmod +x "$DST" 2>/dev/null || true
echo "staged $DST"
