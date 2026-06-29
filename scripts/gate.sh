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
step "Brand sync"      npm run brand:check
# i18n is deferred (KNOWN-I18N-01) — report drift but don't fail the gate.
# Re-add as a blocking `step` once the locale key drift is fixed (NOT via
# i18n:extract, which is destructive).
echo ""; echo "===== i18n key parity (report-only — KNOWN-I18N-01 deferred) ====="
npm run i18n:check || echo "⚠️  i18n key drift (KNOWN-I18N-01, deferred) — not blocking the gate"
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
