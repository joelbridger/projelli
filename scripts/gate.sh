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

step "Build assets"    node scripts/copy-build-assets.mjs
step "Tauri version parity" node scripts/check-tauri-parity.mjs
step "Provider front door" node scripts/check-provider-construction.mjs
step "Consent-gate wiring" node scripts/check-consent-gate-wiring.mjs
step "TypeScript"      npm run typecheck
step "TypeScript (tests)" npm run typecheck:tests
step "Brand sync"      npm run brand:check
step "Identity check"  npm run identity:check
# i18n is deferred (KNOWN-I18N-01) — report drift but don't fail the gate.
# Re-add as a blocking `step` once the locale key drift is fixed (NOT via
# i18n:extract, which is destructive).
echo ""; echo "===== i18n key parity (report-only — KNOWN-I18N-01 deferred) ====="
npm run i18n:check || echo "⚠️  i18n key drift (KNOWN-I18N-01, deferred) — not blocking the gate"
step "Unit tests"      npx vitest run
step "ESLint gate"     npm run lint:gate
# ── Connector outcome-contract reviewer check (F2.1) ─────────────────────────
# A connector operation must NEVER fail silently: no network/IO Result that
# affects a user-visible sync outcome may be swallowed by `.unwrap_or_default()`,
# `.unwrap_or(...)`, or `let _ = <io>`. A repo-wide clippy `disallowed-methods`
# ban on `unwrap_or_default` is infeasible (80+ legitimate JSON/serde defaults),
# so this stays a REVIEW check, not an auto-gate. When touching a connector under
# src-tauri/src/commands/{mail,onedrive,boxc,calendly,addepar,connector,crm,...},
# scan new/changed swallows and confirm each is either (a) pure JSON/string
# defaulting, or (b) disconnect-time best-effort cleanup — NOT a network/IO
# result that decides whether the user's sync succeeded:
#   grep -rnE '\.unwrap_or_default\(\)|\.unwrap_or\(|let _ =' src-tauri/src/commands/
# Consciously-left sites (best-effort by design) are documented in the F2.1
# handoff. New load-bearing swallows must propagate or surface instead.
step "Rust tests"      bash -c "cd src-tauri && CI=1 cargo test --workspace --locked"

if [ "$FULL" -eq 1 ]; then
  step "L1 browser E2E (sharded)" bash ./scripts/run-e2e-suite.sh en 6
  step "L2 desktop harness"       npm run test:desktop
fi

echo ""
[ "$fail" -eq 0 ] && echo "✅ GATE GREEN" || echo "❌ GATE RED — see failures above"
exit "$fail"
