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
# binary with no sibling ggml/whisper runtime libs. This sidesteps the exact
# onnxruntime-DLL-collision problem scripts/build-diarize-sidecar.sh had to
# solve with a dedicated binaries/diarize/ subfolder (see its own comment) —
# there's nothing here to collide with piper's or llama.cpp's libs, so
# `whisper` stays in flat binaries/ next to them.
#
# -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF (added after a coordinator review
# caught both, 2026-07-04 — these were NOT in the first version of this
# script, which would have shipped a real release-corruption-class bug):
#   - ggml's default (GGML_NATIVE=ON) passes `-march=native`, tuning the
#     build for the CI RUNNER's exact CPU. A CI-built binary is what ships
#     to every customer — `-march=native` on the runner can bake in
#     instruction-set extensions an older or different customer CPU lacks,
#     which crashes with SIGILL at runtime, not a build-time error, so CI
#     stays green while real installs crash. GGML_NATIVE=OFF still targets a
#     baseline of SSE4.2/AVX/AVX2/FMA/F16C (ggml's own portable x86_64
#     default) rather than one exact CPU — the same baseline upstream's own
#     published release binaries target, broadly compatible with x86_64
#     hardware from roughly the last decade-plus. (True universal coverage
#     via runtime CPU dispatch needs GGML_CPU_ALL_VARIANTS, which requires
#     GGML_BACKEND_DL, which requires BUILD_SHARED_LIBS=ON — abandoning the
#     static-link design above. Not doing that here; flagging as a possible
#     future improvement if a customer actually hits the AVX2 floor.)
#   - GGML_OPENMP defaults ON, linking `whisper-cli` against libgomp.so.1 on
#     Linux — a real dynamic dependency a plain end-user install may not
#     have (unlike libstdc++/libm/libgcc_s/libc, which are effectively
#     guaranteed on any glibc Linux). OFF keeps the binary's only deps to
#     that same always-present baseline, verified below.
#
# Pinned to a specific ggml-org/whisper.cpp commit (not a moving branch) —
# this is the exact commit built and verified end-to-end (a real
# transcription of the project's own samples/jfk.wav, with these exact
# portable flags) on 2026-07-04. Bump deliberately, re-verify with --help +
# a real transcription before pinning a new commit.
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
CONFIGURE_LOG="$BUILD_DIR-configure.log"

if [[ ! -d "$SRC_DIR/.git" ]]; then
  rm -rf "$SRC_DIR"
  git clone https://github.com/ggml-org/whisper.cpp.git "$SRC_DIR"
fi
pushd "$SRC_DIR" >/dev/null
git fetch --depth 1 origin "$WHISPER_CPP_COMMIT"
git checkout --detach "$WHISPER_CPP_COMMIT"
popd >/dev/null

CMAKE_ARGS=(-DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF)
CMAKE_GENERATOR_ARGS=()
case "${TARGET_TRIPLE:-}" in
  aarch64-apple-darwin) CMAKE_ARGS+=(-DCMAKE_OSX_ARCHITECTURES=arm64) ;;
  x86_64-apple-darwin) CMAKE_ARGS+=(-DCMAKE_OSX_ARCHITECTURES=x86_64) ;;
esac

if [[ "${OS:-}" == "Windows_NT" ]]; then
  # Strawberry Perl's bundled MinGW gcc is intentionally early on PATH for
  # the OpenSSL workaround. Do not let CMake's default compiler probe pick it
  # up for whisper.cpp: its Windows headers are too old for this pinned ggml.
  # Select MSVC directly instead. Remove a prior CMake cache too, because a
  # cache configured with MinGW cannot be safely reused with this generator.
  rm -rf "$BUILD_DIR"
  CMAKE_GENERATOR_ARGS=(-G "Visual Studio 17 2022" -A x64)
fi

JOBS="$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"
cmake -B "$BUILD_DIR" -S "$SRC_DIR" "${CMAKE_GENERATOR_ARGS[@]}" "${CMAKE_ARGS[@]}" 2>&1 | tee "$CONFIGURE_LOG"
# Portability guard, not a one-time manual check: if a future ggml/whisper.cpp
# version ever re-introduces native tuning by default (or this script's flags
# regress), fail the build loudly instead of silently shipping a
# runner-CPU-tuned binary to every customer again.
if grep -q -- '-march=native' "$CONFIGURE_LOG"; then
  echo "::error::-march=native found in cmake configure output despite GGML_NATIVE=OFF — this build would be tuned to the CI runner's exact CPU and crash on other customer machines. Refusing to build." >&2
  exit 1
fi
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

# Dynamic-dependency guard (Linux only — `ldd` isn't a thing on macOS/Windows
# and BUILD_SHARED_LIBS=OFF/no-externalBin already keeps this static there).
# Anything beyond this always-present glibc/libstdc++ baseline is a real
# runtime dependency a plain customer install may not have — fail loudly
# rather than ship a binary that works on this runner and crashes on a
# customer's machine with a missing-shared-library error.
if [[ "${OS:-}" != "Windows_NT" ]] && command -v ldd &>/dev/null && ldd "$DST" &>/dev/null; then
  ALLOWED='linux-vdso|libstdc\+\+|libm\.so|libgcc_s|libc\.so|libpthread|ld-linux'
  UNEXPECTED="$(ldd "$DST" | grep -viE "$ALLOWED" | grep '=>' || true)"
  if [[ -n "$UNEXPECTED" ]]; then
    echo "::error::unexpected dynamic dependency in $DST — a plain customer install may not have this library:" >&2
    echo "$UNEXPECTED" >&2
    exit 1
  fi
fi
