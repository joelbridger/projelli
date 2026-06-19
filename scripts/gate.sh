#!/usr/bin/env bash
# scripts/gate.sh — the canonical pre-merge / pre-release gate, in order.
# Usage:
#   scripts/gate.sh         # fast gate: typecheck + i18n + vitest + lint + cargo
#   scripts/gate.sh --full  # also runs L1 browser suite + L2 desktop harness (slow; for nightly/release)
set -uo pipefail
cd "$(dirname "$0")/.."
FULL=0; [ "${1:-}" = "--full" ] && FULL=1
fail=0
step () { echo ""; echo "===== $1 ====="; shift; "$@" || { echo "❌ FAILED: $*"; fail=1; }; }

step "TypeScript"      npm run typecheck
step "i18n key parity" npm run i18n:check
step "Unit tests"      npx vitest run
step "ESLint gate"     npm run lint:gate
step "Rust tests"      bash -c "cd src-tauri && CI=1 cargo test --workspace --locked"

if [ "$FULL" -eq 1 ]; then
  step "L1 browser E2E (sharded)" bash ./scripts/run-e2e-suite.sh en 6
  step "L2 desktop harness"       npm run test:desktop
fi

echo ""
[ "$fail" -eq 0 ] && echo "✅ GATE GREEN" || echo "❌ GATE RED — see failures above"
exit "$fail"
