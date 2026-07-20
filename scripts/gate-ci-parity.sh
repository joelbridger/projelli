#!/usr/bin/env bash
# scripts/gate-ci-parity.sh — runs what CI (.github/workflows/ci.yml and
# release.yml) checks that scripts/gate.sh does NOT: the frontend coverage
# floor, the backend (bun) typecheck + tests, and the cargo-deny supply-chain
# gate. Lets a release operator pre-flight the full CI surface locally before
# pushing/tagging, instead of finding out about a coverage or license
# regression only after CI runs.
#
# This is a companion to scripts/gate.sh, not a replacement — run both:
#   npm run gate && npm run gate:ci-parity
#
# Degrades gracefully: a tool that isn't installed locally (bun, cargo-deny)
# is reported as SKIPPED, not a failure, so this still gives useful signal on
# a machine that doesn't have every toolchain.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
step () { echo ""; echo "===== $1 ====="; shift; "$@" || { echo "❌ FAILED: $*"; fail=1; }; }
skip () { echo ""; echo "===== $1 ====="; echo "⚠️  SKIPPED: $2"; }

step "Frontend coverage floor (matches ci.yml quality job)" npm run test:coverage

if command -v bun >/dev/null 2>&1; then
  step "Backend install (matches ci.yml backend job)"    bash -c "cd backend && bun install --frozen-lockfile"
  step "Canonical backend gate (matches ci.yml backend job)" npm run backend:gate
else
  skip "Canonical backend gate (matches ci.yml backend job)" "bun not found on PATH — install from https://bun.sh to run this locally"
fi

if command -v cargo-deny >/dev/null 2>&1; then
  step "cargo-deny (matches ci.yml cargo-deny job)" bash -c "cd src-tauri && cargo deny check advisories licenses sources bans"
else
  skip "cargo-deny (matches ci.yml cargo-deny job)" "cargo-deny not found on PATH — install with 'cargo install cargo-deny' to run this locally"
fi

echo ""
[ "$fail" -eq 0 ] && echo "✅ CI-PARITY GREEN (see above for any SKIPPED tools)" || echo "❌ CI-PARITY RED — see failures above"
exit "$fail"
