#!/usr/bin/env bash
# Download Piper binary and the bundled English voice for the current platform.
# Run once after cloning or when upgrading Piper.
#
# Usage: bash scripts/fetch-piper-sidecar.sh
#
# Piper releases: https://github.com/rhasspy/piper/releases
# Voice files: https://keepance.com/voices/

set -euo pipefail

PIPER_VERSION="2023.11.14-2"
BINARIES_DIR="src-tauri/binaries"
VOICES_DIR="src-tauri/voices"
CDN_BASE="https://keepance.com/voices"

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

# Download bundled English voice from Keepance CDN.
VOICE_ID="en_US-amy-medium"
VOICE_ARCHIVE="$VOICE_ID.tar.gz"
echo "Downloading bundled voice: $VOICE_ID..."
curl -fsSL "$CDN_BASE/$VOICE_ARCHIVE" -o "$TMP/$VOICE_ARCHIVE"
tar -xzf "$TMP/$VOICE_ARCHIVE" -C "$VOICES_DIR"
echo "Voice files extracted to: $VOICES_DIR/$VOICE_ID/"

echo ""
echo "Done. Piper is ready for tauri dev builds."
echo "Run: npm run tauri:dev"
