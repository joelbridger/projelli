#!/usr/bin/env bash
# Download the pinned llama.cpp server sidecar and its sibling runtime libs.
#
# Usage:
#   bash scripts/fetch-llama-sidecar.sh
#   TARGET_TRIPLE=x86_64-pc-windows-msvc bash scripts/fetch-llama-sidecar.sh
#
# The Windows CPU asset is intentionally pinned and verified by URL in this
# change: llama-b9789-bin-win-cpu-x64.zip returns HTTP 200.

set -euo pipefail

LLAMA_VERSION="b9789"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BINARIES_DIR="$REPO_ROOT/src-tauri/binaries"
RELEASE_BASE="https://github.com/ggml-org/llama.cpp/releases/download/$LLAMA_VERSION"

mkdir -p "$BINARIES_DIR"

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
  x86_64-pc-windows-msvc)
    ARCHIVE="llama-$LLAMA_VERSION-bin-win-cpu-x64.zip"
    SERVER_NAME="llama-server.exe"
    DEST_BIN="llama-server-$TARGET_TRIPLE.exe"
    LIB_GLOB="*.dll"
    ;;
  x86_64-unknown-linux-gnu)
    ARCHIVE="llama-$LLAMA_VERSION-bin-ubuntu-x64.tar.gz"
    SERVER_NAME="llama-server"
    DEST_BIN="llama-server-$TARGET_TRIPLE"
    LIB_GLOB="*.so*"
    ;;
  aarch64-apple-darwin)
    ARCHIVE="llama-$LLAMA_VERSION-bin-macos-arm64.tar.gz"
    SERVER_NAME="llama-server"
    DEST_BIN="llama-server-$TARGET_TRIPLE"
    LIB_GLOB="*.dylib"
    ;;
  x86_64-apple-darwin)
    ARCHIVE="llama-$LLAMA_VERSION-bin-macos-x64.tar.gz"
    SERVER_NAME="llama-server"
    DEST_BIN="llama-server-$TARGET_TRIPLE"
    LIB_GLOB="*.dylib"
    ;;
  *)
    echo "Unsupported llama.cpp target triple: $TARGET_TRIPLE" >&2
    exit 1
    ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading llama.cpp $LLAMA_VERSION for $TARGET_TRIPLE..."
if [[ "$ARCHIVE" == *.zip ]]; then
  curl -fsSL "$RELEASE_BASE/$ARCHIVE" -o "$TMP/llama.zip"
  unzip -q "$TMP/llama.zip" -d "$TMP"
else
  curl -fsSL "$RELEASE_BASE/$ARCHIVE" -o "$TMP/llama.tar.gz"
  tar -xzf "$TMP/llama.tar.gz" -C "$TMP"
fi

SRC_DIR="$(find "$TMP" -type f -name "$SERVER_NAME" -exec dirname {} \; | head -n 1)"
if [[ -z "$SRC_DIR" || ! -f "$SRC_DIR/$SERVER_NAME" ]]; then
  echo "llama-server binary not found in archive: $SERVER_NAME" >&2
  exit 1
fi

cp "$SRC_DIR/$SERVER_NAME" "$BINARIES_DIR/$DEST_BIN"
chmod +x "$BINARIES_DIR/$DEST_BIN" || true

# Copy the sibling runtime libraries. The shipped executable must stay in this
# same directory because OS loaders search the launched exe's folder first.
shopt -s nullglob
LIBS=("$SRC_DIR"/$LIB_GLOB)
if (( ${#LIBS[@]} == 0 )); then
  echo "No sibling runtime libraries matching $LIB_GLOB found in $ARCHIVE" >&2
  exit 1
fi
cp -a "${LIBS[@]}" "$BINARIES_DIR/"
shopt -u nullglob

echo "llama-server binary: $BINARIES_DIR/$DEST_BIN"
echo "Runtime libraries copied: ${#LIBS[@]}"
echo ""
echo "Done. llama.cpp is ready for Tauri builds."
