#!/usr/bin/env bash
# Publish the Keepance Board Dashboard to its private host (board.jameworld.com).
#
# Source of truth: docs/board/board-data.json (content) + docs/board/index.html (design).
# Edit those, then run this script. The host service serves the copied files behind the
# Jameworld login.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${HOME}/board/public"

mkdir -p "$DEST"

# Validate the JSON BEFORE copying, so a typo can never ship a broken board.
if command -v node >/dev/null 2>&1; then
  node -e "JSON.parse(require('fs').readFileSync('$SRC/board-data.json','utf8'))" \
    && echo "✓ board-data.json is valid JSON" \
    || { echo "✗ board-data.json is invalid — fix it before deploying"; exit 1; }
fi

cp "$SRC"/*.html "$SRC/board-data.json" "$DEST/"
echo "✓ Published to $DEST"
echo "  View (logged in): https://board.jameworld.com"
