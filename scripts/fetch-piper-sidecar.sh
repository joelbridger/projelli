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
CDN_BASE="https://keepance.com/voices"
FETCH_PIPER_VOICE="${FETCH_PIPER_VOICE:-1}"

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
  unzip -q "$TMP/piper.zip" -d "$TMP"
else
  curl -fsSL "$RELEASE_BASE/$ARCHIVE" -o "$TMP/piper.tar.gz"
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
echo "Piper binary: $BINARIES_DIR/$DEST_BIN"

if [[ "$FETCH_PIPER_VOICE" == "1" ]]; then
  # Download bundled English voice from Keepance CDN. This is useful for local
  # dev setup, but release sidecar staging must not fail if the CDN voice URL
  # is temporarily serving an HTML page instead of the archive.
  VOICE_ID="en_US-amy-medium"
  VOICE_ARCHIVE="$VOICE_ID.tar.gz"
  echo "Downloading bundled voice: $VOICE_ID..."
  if curl -fsSL "$CDN_BASE/$VOICE_ARCHIVE" -o "$TMP/$VOICE_ARCHIVE" \
    && tar -tzf "$TMP/$VOICE_ARCHIVE" >/dev/null 2>&1; then
    tar -xzf "$TMP/$VOICE_ARCHIVE" -C "$VOICES_DIR"
    echo "Voice files extracted to: $VOICES_DIR/$VOICE_ID/"
  else
    echo "Warning: bundled voice archive was not available; Piper sidecar staging is still complete." >&2
  fi
else
  echo "Skipping bundled voice download (FETCH_PIPER_VOICE=$FETCH_PIPER_VOICE)."
fi

echo ""
echo "Done. Piper is ready for Tauri builds."
