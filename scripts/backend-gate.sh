#!/usr/bin/env bash
# Canonical backend gate. Local gates and CI call this exact file so the type
# boundary, structural checker, checker self-test, and behavior suite cannot
# drift into disjoint green paths.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
step () { echo ""; echo "===== $1 ====="; shift; "$@" || { echo "❌ FAILED: $*"; fail=1; }; }

step "Backend body-boundary self-test" npm run backend:body-readers:test
step "Backend body-boundary scan" npm run backend:body-readers:check
step "Backend TypeScript" bash -c "cd backend && bun run typecheck"
step "Backend behavior tests" bash -c "cd backend && bun test"

echo ""
[ "$fail" -eq 0 ] && echo "✅ CANONICAL BACKEND GATE GREEN" || echo "❌ CANONICAL BACKEND GATE RED"
exit "$fail"
