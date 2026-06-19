#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
chmod +x .githooks/* 2>/dev/null || true
git config core.hooksPath .githooks
echo "✅ git hooks installed (core.hooksPath=.githooks)"
