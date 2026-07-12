#!/usr/bin/env bash
# Download Piper and the bundled English voice for the current platform.
#
# Usage:
#   bash scripts/fetch-piper-sidecar.sh
#   TARGET_TRIPLE=x86_64-pc-windows-msvc bash scripts/fetch-piper-sidecar.sh
#
# Piper releases: https://github.com/rhasspy/piper/releases
# Voice files: https://keepance.com/voices/

set -euo pipefail

PIPER_VERSION="2023.11.14-2"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BINARIES_DIR="$REPO_ROOT/src-tauri/binaries"
VOICES_DIR="$REPO_ROOT/src-tauri/voices"
# Official rhasspy/piper-voices repo on HuggingFace, pinned to a specific commit
# so the download is immutable. Update this hash when upgrading the voice model.
HF_COMMIT="e21c7de8d4eab79b902f0d61e662b3f21664b8d2"
HF_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/$HF_COMMIT"
FETCH_PIPER_VOICE="${FETCH_PIPER_VOICE:-1}"

# Pinned SHA256 digests — computed from upstream release artifacts at 2023.11.14-2.
# Fail loudly on mismatch so a replaced or corrupt asset is never staged.
# Uses a case statement (not declare -A) to stay compatible with macOS Bash 3.2.
get_piper_sha256() {
  case "$1" in
    "piper_linux_x86_64.tar.gz")   echo "a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992" ;;
    "piper_macos_aarch64.tar.gz")  echo "6b1eb03b3735946cb35216e063e7eebcc33a6bbf5dd96ec0217959bf1cdcb0cc" ;;
    "piper_macos_x64.tar.gz")      echo "ced85c0a3df13945b1e623b878a48fdc2854d5c485b4b67f62857cf551deaf8b" ;;
    "piper_windows_amd64.zip")     echo "f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea" ;;
    *) echo "" ;;
  esac
}

# Pinned SHA256 digests for the bundled en_US-amy-medium voice model, computed
# from HuggingFace rhasspy/piper-voices at commit e21c7de8d4eab79b902f0d61e662b3f21664b8d2.
get_voice_sha256() {
  case "$1" in
    "en_US-amy-medium.onnx")      echo "b3a6e47b57b8c7fbe6a0ce2518161a50f59a9cdd8a50835c02cb02bdd6206c18" ;;
    "en_US-amy-medium.onnx.json") echo "95a23eb4d42909d38df73bb9ac7f45f597dbfcde2d1bf9526fdeaf5466977d77" ;;
    *) echo "" ;;
  esac
}

verify_sha256() {
  local file="$1" expected="$2"
  local actual
  if command -v sha256sum &>/dev/null; then
    actual=$(sha256sum "$file" | awk '{print $1}')
  else
    actual=$(shasum -a 256 "$file" | awk '{print $1}')
  fi
  if [[ "$actual" != "$expected" ]]; then
    echo "SHA256 mismatch for $file" >&2
    echo "  expected: $expected" >&2
    echo "  got:      $actual" >&2
    exit 1
  fi
  echo "SHA256 verified: $(basename "$file")"
}

# The legacy Piper macOS archives are named by architecture, but a release can
# still contain the wrong Mach-O slice. Do not let a successful download turn
# into a broken arm64 app at runtime.
verify_macos_binary() {
  local binary="$1" expected_arch="$2" actual_archs missing=0 dep

  [[ "$(uname -s)" == "Darwin" ]] || return 0

  if ! command -v lipo >/dev/null 2>&1; then
    echo "Cannot verify macOS sidecar architecture: lipo is unavailable" >&2
    exit 1
  fi
  actual_archs="$(lipo -archs "$binary")"
  if [[ " $actual_archs " != *" $expected_arch "* ]]; then
    echo "Piper archive staged the wrong macOS architecture." >&2
    echo "  expected: $expected_arch" >&2
    echo "  actual:   $actual_archs" >&2
    echo "Do not bundle this sidecar. Use a Piper release with a native $expected_arch binary." >&2
    exit 1
  fi

  # A Mach-O binary with @rpath dependencies also needs those sibling dylibs
  # in the staged directory. Without them it can pass a build then die the
  # first time a user asks for speech.
  if command -v otool >/dev/null 2>&1; then
    while IFS= read -r dep; do
      [[ -z "$dep" ]] && continue
      if [[ ! -e "$BINARIES_DIR/${dep##*/}" ]]; then
        echo "Piper archive is missing required macOS runtime library: ${dep##*/}" >&2
        missing=1
      fi
    done < <(otool -L "$binary" | awk 'NR > 1 && $1 ~ /^@rpath\// { print $1 }')
    if [[ "$missing" -ne 0 ]]; then
      echo "Do not bundle this incomplete Piper archive." >&2
      exit 1
    fi
  fi
}

mkdir -p "$BINARIES_DIR" "$VOICES_DIR"

detect_target_triple() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os/$arch" in
    Linux/x86_64)
      echo "x86_64-unknown-linux-gnu"
      ;;
    Darwin/arm64)
      echo "aarch64-apple-darwin"
      ;;
    Darwin/x86_64)
      echo "x86_64-apple-darwin"
      ;;
    MINGW64_NT-*/*|MSYS_NT-*/*|CYGWIN_NT-*/*)
      echo "x86_64-pc-windows-msvc"
      ;;
    *)
      echo "Unsupported platform: $os/$arch" >&2
      exit 1
      ;;
  esac
}

TARGET_TRIPLE="${TARGET_TRIPLE:-$(detect_target_triple)}"

case "$TARGET_TRIPLE" in
  x86_64-unknown-linux-gnu)
    ARCHIVE="piper_linux_x86_64.tar.gz"
    BIN_NAME="piper"
    DEST_BIN="piper-$TARGET_TRIPLE"
    ;;
  aarch64-apple-darwin)
    ARCHIVE="piper_macos_aarch64.tar.gz"
    BIN_NAME="piper"
    DEST_BIN="piper-$TARGET_TRIPLE"
    ;;
  x86_64-apple-darwin)
    ARCHIVE="piper_macos_x64.tar.gz"
    BIN_NAME="piper"
    DEST_BIN="piper-$TARGET_TRIPLE"
    ;;
  x86_64-pc-windows-msvc)
    ARCHIVE="piper_windows_amd64.zip"
    BIN_NAME="piper.exe"
    DEST_BIN="piper-$TARGET_TRIPLE.exe"
    ;;
  *)
    echo "Unsupported Piper target triple: $TARGET_TRIPLE" >&2
    exit 1
    ;;
esac

RELEASE_BASE="https://github.com/rhasspy/piper/releases/download/$PIPER_VERSION"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading Piper $PIPER_VERSION for $TARGET_TRIPLE..."
if [[ "$ARCHIVE" == *.zip ]]; then
  curl -fsSL "$RELEASE_BASE/$ARCHIVE" -o "$TMP/piper.zip"
  verify_sha256 "$TMP/piper.zip" "$(get_piper_sha256 "$ARCHIVE")"
  unzip -q "$TMP/piper.zip" -d "$TMP"
else
  curl -fsSL "$RELEASE_BASE/$ARCHIVE" -o "$TMP/piper.tar.gz"
  verify_sha256 "$TMP/piper.tar.gz" "$(get_piper_sha256 "$ARCHIVE")"
  tar -xzf "$TMP/piper.tar.gz" -C "$TMP"
fi

SRC_DIR="$TMP/piper"
SRC_BIN="$SRC_DIR/$BIN_NAME"
if [[ ! -f "$SRC_BIN" ]]; then
  echo "Piper binary not found in archive: $BIN_NAME" >&2
  exit 1
fi

# Copy Piper's sibling runtime files too. On Windows this includes DLLs
# (espeak-ng, onnxruntime, piper_phonemize); all platforms also need the
# espeak-ng-data directory beside the binary for pronunciation support.
cp -a "$SRC_DIR/." "$BINARIES_DIR/"
mv "$BINARIES_DIR/$BIN_NAME" "$BINARIES_DIR/$DEST_BIN"
chmod +x "$BINARIES_DIR/$DEST_BIN" || true
test -s "$BINARIES_DIR/$DEST_BIN" || { echo "Staged piper binary is empty: $DEST_BIN" >&2; exit 1; }
case "$TARGET_TRIPLE" in
  aarch64-apple-darwin) verify_macos_binary "$BINARIES_DIR/$DEST_BIN" arm64 ;;
  x86_64-apple-darwin)  verify_macos_binary "$BINARIES_DIR/$DEST_BIN" x86_64 ;;
esac
echo "Piper binary: $BINARIES_DIR/$DEST_BIN"

if [[ "$FETCH_PIPER_VOICE" == "1" ]]; then
  # Download the bundled English voice directly from the canonical HuggingFace
  # repo. When FETCH_PIPER_VOICE=1, the voice is required — release builds set
  # this so tts_sidecar_available() returns true at runtime.
  # The Rust runtime expects: resource_dir/voices/en_US-amy-medium/<files>
  VOICE_ID="en_US-amy-medium"
  HF_VOICE_DIR="en/en_US/amy/medium"
  VOICE_DEST="$VOICES_DIR/$VOICE_ID"
  mkdir -p "$VOICE_DEST"
  echo "Downloading bundled voice: $VOICE_ID from HuggingFace..."
  for VOICE_FILE in "$VOICE_ID.onnx" "$VOICE_ID.onnx.json"; do
    if ! curl -fsSL "$HF_BASE/$HF_VOICE_DIR/$VOICE_FILE" -o "$VOICE_DEST/$VOICE_FILE"; then
      echo "Error: failed to download voice file: $HF_BASE/$HF_VOICE_DIR/$VOICE_FILE" >&2
      exit 1
    fi
    verify_sha256 "$VOICE_DEST/$VOICE_FILE" "$(get_voice_sha256 "$VOICE_FILE")"
    echo "  staged: $VOICE_DEST/$VOICE_FILE"
  done
  echo "Voice files staged to: $VOICE_DEST/"
else
  echo "Skipping bundled voice download (FETCH_PIPER_VOICE=$FETCH_PIPER_VOICE)."
fi

echo ""
echo "Done. Piper is ready for Tauri builds."
